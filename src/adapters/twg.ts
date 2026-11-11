// Teamwork Graph: the context Jira alone cannot give. Uses curated queries
// only (no Cypher to register), each with a plainer fallback, and degrades to
// "unavailable" instead of failing the whole handover.
import api from '@forge/api';
import type { Goal, PullRequest, SourceState, Teammate } from '../core/types';
import { edgesOf, isAccountId, parseGoalsAndProjects, parsePullRequests, parseTeamMembers, parseTeams } from './parse';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

interface Attempt {
  op: string;
  query: string;
  variables: Record<string, unknown>;
}

interface Outcome {
  data?: Json;
  error?: string;
}

export const userAri = (accountId: string) => `ari:cloud:identity::user/${accountId}`;
export const workItemAri = (cloudId: string, issueId: string) => `ari:cloud:jira:${cloudId}:issue/${issueId}`;

/**
 * Teamwork Graph sometimes refuses a read with this message and accepts the
 * same read a moment later (seen on Forge demo sites), so it is retried.
 */
const ORG_DENIED = /not permitted to query this organi[sz]ation/i;
const ORG_DENIED_RETRIES = 2;

async function run(a: Attempt): Promise<Outcome> {
  for (let attempt = 0; ; attempt++) {
    const out = await runOnce(a);
    if (!out.error || !ORG_DENIED.test(out.error) || attempt >= ORG_DENIED_RETRIES) return out;
    await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt + Math.random() * 150));
  }
}

async function runOnce(a: Attempt): Promise<Outcome> {
  try {
    const res = await api.asUser().requestTeamworkGraph(a.query, a.variables, a.op);
    const json: Json = await res.json().catch(() => ({}));
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return { data: json.data, error: String(json.errors[0]?.message ?? 'GraphQL error') };
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { data: json?.data ?? {} };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs each attempt in turn and returns the first one that answers without errors. */
async function firstThatWorks(attempts: Attempt[]): Promise<Outcome> {
  let last: Outcome = { error: 'not run' };
  for (const a of attempts) {
    last = await run(a);
    if (!last.error) return last;
  }
  return last;
}

const PR_FIELDS = '__typename ... on ExternalPullRequest { id title url status displayId lastUpdatedAt }';

const userPullRequests = (userId: string): Attempt[] => [
  {
    op: 'understudy_userPullRequests',
    query: `query understudy_userPullRequests($userId: ID!) { atlassianUserPullRequests(userId: $userId, since: "P30D", first: 25) { edges { node { ${PR_FIELDS} } } } }`,
    variables: { userId },
  },
  {
    op: 'understudy_userPullRequestsPlain',
    query: `query understudy_userPullRequestsPlain($userId: ID!) { atlassianUserPullRequests(userId: $userId, first: 25) { edges { node { __typename ... on ExternalPullRequest { id title url status } } } } }`,
    variables: { userId },
  },
];

const goalsAndProjects = (userId: string): Attempt[] => [
  {
    op: 'understudy_goalsAndProjects',
    query: `query understudy_goalsAndProjects($userId: ID!) { atlassianUserGoalsAndProjects(userId: $userId, first: 25) { edges { node { __typename ... on AtlassianGoal { id name url archived dueDateEndedAt } ... on AtlassianProject { id name url archived state dueDateEndedAt } } } } }`,
    variables: { userId },
  },
  {
    op: 'understudy_goalsAndProjectsPlain',
    query: `query understudy_goalsAndProjectsPlain($userId: ID!) { atlassianUserGoalsAndProjects(userId: $userId, first: 25) { edges { node { __typename ... on AtlassianGoal { id name url } ... on AtlassianProject { id name url } } } } }`,
    variables: { userId },
  },
];

const teamsOf = (userId: string): Attempt[] => [
  {
    op: 'understudy_userTeams',
    query: `query understudy_userTeams($userId: ID!) { atlassianUserInTeams(userId: $userId, first: 5) { edges { node { __typename ... on AtlassianTeam { id displayName } } } } }`,
    variables: { userId },
  },
];

const membersOf = (teamAri: string): Attempt[] => [
  {
    op: 'understudy_teamMembers',
    query: `query understudy_teamMembers($teamAri: ID!) { atlassianTeamMembers(teamAri: $teamAri, first: 25) { edges { node { __typename ... on AtlassianUser { accountId name } } } } }`,
    variables: { teamAri },
  },
];

/** One request for the pull requests linked to up to 10 work items, using aliases. */
function itemPullRequests(items: { key: string; ari: string }[]): Attempt {
  const vars: Record<string, unknown> = {};
  const decl: string[] = [];
  const fields: string[] = [];
  items.forEach((it, i) => {
    vars[`w${i}`] = it.ari;
    decl.push(`$w${i}: ID!`);
    fields.push(`w${i}: jiraWorkItemLinkedExternalPullRequests(id: $w${i}, first: 5) { edges { node { ${PR_FIELDS} } } }`);
  });
  return {
    op: 'understudy_itemPullRequests',
    query: `query understudy_itemPullRequests(${decl.join(', ')}) { ${fields.join(' ')} }`,
    variables: vars,
  };
}

export interface GraphContext {
  pullRequests: PullRequest[];
  goals: Goal[];
  teammates: Teammate[];
  itemPullRequests: Record<string, PullRequest[]>;
  state: SourceState;
  notes: string[];
}

/**
 * Teams of the person asking that `personId` is a member of. Teamwork Graph
 * does not always link a person to their teams (seen with a site's sample
 * users), while the team's member list does include them.
 */
async function teamsThroughRequester(personId: string, requesterId: string): Promise<{ teams: { id: string; name: string }[]; members: Outcome[] }> {
  const mine = await firstThatWorks(teamsOf(userAri(requesterId)));
  const candidates = parseTeams(mine.data?.atlassianUserInTeams).slice(0, 5);
  const lists = await Promise.all(candidates.map((t) => firstThatWorks(membersOf(t.id))));
  const shared = candidates
    .map((team, i) => ({ team, members: lists[i] as Outcome }))
    .filter((x) => parseTeamMembers(x.members.data?.atlassianTeamMembers).some((m) => m.accountId === personId))
    .slice(0, 3);
  return { teams: shared.map((x) => x.team), members: shared.map((x) => x.members) };
}

export async function readGraph(
  personId: string,
  items: { key: string; id: string }[],
  cloudId: string | undefined,
  requesterId?: string,
): Promise<GraphContext> {
  const empty: GraphContext = { pullRequests: [], goals: [], teammates: [], itemPullRequests: {}, state: 'unavailable', notes: [] };
  if (!isAccountId(personId)) return { ...empty, notes: ['Teamwork Graph skipped: invalid account ID.'] };
  const userId = userAri(personId);

  const linked = cloudId ? items.slice(0, 10).map((it) => ({ key: it.key, ari: workItemAri(cloudId, it.id) })) : [];
  const [prs, goals, teams, perItem] = await Promise.all([
    firstThatWorks(userPullRequests(userId)),
    firstThatWorks(goalsAndProjects(userId)),
    firstThatWorks(teamsOf(userId)),
    linked.length ? run(itemPullRequests(linked)) : Promise.resolve<Outcome>({ data: {} }),
  ]);

  const out: GraphContext = { ...empty };
  const outcomes = [prs, goals, teams, perItem];
  const failures = outcomes.filter((o) => o.error);

  out.pullRequests = parsePullRequests(prs.data?.atlassianUserPullRequests);
  out.goals = parseGoalsAndProjects(goals.data?.atlassianUserGoalsAndProjects);
  linked.forEach((it, i) => {
    const list = parsePullRequests(perItem.data?.[`w${i}`], it.key);
    if (list.length) out.itemPullRequests[it.key] = list;
  });

  let teamList = parseTeams(teams.data?.atlassianUserInTeams).slice(0, 3);
  let members = await Promise.all(teamList.map((t) => firstThatWorks(membersOf(t.id))));
  if (teamList.length === 0 && requesterId && requesterId !== personId && isAccountId(requesterId)) {
    const shared = await teamsThroughRequester(personId, requesterId);
    teamList = shared.teams;
    members = shared.members;
  }
  const mates = new Map<string, Teammate>();
  teamList.forEach((team, i) => {
    for (const m of parseTeamMembers(members[i]?.data?.atlassianTeamMembers)) {
      if (m.accountId === personId) continue;
      const entry = mates.get(m.accountId) ?? { accountId: m.accountId, displayName: m.displayName, teams: [] };
      entry.teams.push(team.name);
      mates.set(m.accountId, entry);
    }
  });
  out.teammates = [...mates.values()];

  const found = out.pullRequests.length + out.goals.length + out.teammates.length + Object.keys(out.itemPullRequests).length;
  // Counts and error messages only, never names or IDs: enough to tell an
  // empty graph from a missing scope in `forge logs`.
  console.info(
    '[understudy] teamwork graph',
    JSON.stringify({
      pullRequests: out.pullRequests.length,
      goals: out.goals.length,
      teams: teamList.length,
      teammates: out.teammates.length,
      itemsWithPullRequests: Object.keys(out.itemPullRequests).length,
      errors: failures.map((f) => f.error),
      memberErrors: members.filter((m) => m.error).map((m) => m.error),
      memberCounts: members.map((m) => edgesOf(m.data?.atlassianTeamMembers).length),
    }),
  );
  out.state = failures.length === outcomes.length ? 'unavailable' : found > 0 ? 'ok' : 'empty';
  if (failures.length) out.notes.push(`Teamwork Graph: ${failures.length} of ${outcomes.length} queries failed (${failures[0]?.error}).`);
  if (out.state === 'empty') {
    out.notes.push(
      'Teamwork Graph answered but has no teams, goals or pull requests for this person. If you expected some, check that an admin granted the read:graph scopes.',
    );
  }
  return out;
}
