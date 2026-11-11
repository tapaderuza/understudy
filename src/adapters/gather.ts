// Collects one person's work context from Jira, Confluence and Teamwork
// Graph. Each source can fail on its own; the snapshot says which ones
// answered so the UI and the agent can be honest about gaps.
import { isIsoDay } from '../core/dates';
import type { ReturnItem } from '../core/handback';
import type { Absence, Person, Snapshot, Sources } from '../core/types';
import { ISSUE_FIELDS, approximateCount, getPerson, recentPagesBy, searchIssues } from './atlassian';
import { countByAssignee, isAccountId, isProjectKey, parseIssue, parsePeerWork, parseReturnIssue, quoteIds, siteFromSelf } from './parse';
import { readGraph } from './twg';

const MAX_ITEMS = 100;
const MAX_PEER_ITEMS = 200;
const MAX_CANDIDATES = 30;
const COUNT_BATCH = 10;

/**
 * Open items per person, one count each. A single shared search would let one
 * very busy person use up the result limit and make everyone else look idle.
 */
async function openLoadOf(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += COUNT_BATCH) {
    const batch = ids.slice(i, i + COUNT_BATCH);
    const counts = await Promise.all(batch.map((id) => approximateCount(`assignee = "${id}" AND statusCategory != Done`)));
    batch.forEach((id, j) => (out[id] = counts[j] ?? 0));
  }
  return out;
}

export interface GatherOptions {
  personId: string;
  absence: Absence;
  today: string;
  cloudId?: string;
  /** Skip the person lookup when the caller already has it. */
  person?: Person;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Work the person owns, reported or watches that others touched since the
 * absence began, with each item's changelog and comments.
 */
export async function gatherReturn(personId: string, since: string): Promise<ReturnItem[]> {
  if (!isAccountId(personId)) throw new Error('A valid account ID is required.');
  if (!isIsoDay(since)) throw new Error('The first day away must be a date like 2026-12-01.');
  const raw = await searchIssues(
    `(assignee = "${personId}" OR reporter = "${personId}" OR watcher = "${personId}") AND updated >= "${since}" ORDER BY updated DESC`,
    ['summary', 'status', 'assignee', 'updated', 'comment'],
    50,
    'changelog',
  );
  return raw.map((r) => parseReturnIssue(r, personId, since)).filter((x): x is ReturnItem => Boolean(x));
}

export async function gatherSnapshot(o: GatherOptions): Promise<Snapshot> {
  if (!isAccountId(o.personId)) throw new Error('A valid account ID is required.');
  const notes: string[] = [];
  const sources: Sources = { jira: 'ok', confluence: 'ok', teamworkGraph: 'unavailable', notes };

  const person = o.person ?? (await getPerson(o.personId));
  const rawItems = await searchIssues(
    `assignee = "${o.personId}" AND statusCategory != Done ORDER BY priority DESC, duedate ASC`,
    ISSUE_FIELDS,
    MAX_ITEMS,
  );
  const workItems = rawItems.map(parseIssue).filter((w): w is NonNullable<typeof w> => Boolean(w));
  if (workItems.length === 0) sources.jira = 'empty';
  const siteUrl = siteFromSelf(rawItems[0]?.self);

  const projects = [...new Set(workItems.map((w) => w.projectKey))].filter(isProjectKey).slice(0, 10);

  const [peerRes, pagesRes, graph] = await Promise.all([
    projects.length
      ? searchIssues(
          `project in (${projects.join(', ')}) AND assignee is not EMPTY AND assignee != "${o.personId}" AND updated >= -90d ORDER BY updated DESC`,
          ['assignee', 'project', 'parent', 'labels', 'components', 'updated'],
          MAX_PEER_ITEMS,
        ).then(
          (v) => ({ ok: true as const, v }),
          (e) => ({ ok: false as const, e }),
        )
      : Promise.resolve({ ok: true as const, v: [] }),
    recentPagesBy(o.personId).then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    ),
    readGraph(o.personId, workItems, o.cloudId),
  ]);

  const peerWork = peerRes.ok ? peerRes.v.map(parsePeerWork).filter((p): p is NonNullable<typeof p> => Boolean(p)) : [];
  if (!peerRes.ok) notes.push(`Could not read teammates' recent work: ${message(peerRes.e)}`);

  let pages = pagesRes.ok ? pagesRes.v : [];
  if (!pagesRes.ok) {
    sources.confluence = 'unavailable';
    notes.push('Confluence was not reachable. Connect Understudy to Confluence to include pages and publish handovers.');
    pages = [];
  } else if (pages.length === 0) {
    sources.confluence = 'empty';
  }

  sources.teamworkGraph = graph.state;
  notes.push(...graph.notes);
  for (const w of workItems) w.pullRequests = graph.itemPullRequests[w.key] ?? [];

  // Everyone who might cover: people with context on these items, plus teammates.
  const candidateIds = [
    ...new Set([
      ...workItems.flatMap((w) => w.comments.map((c) => c.accountId)),
      ...workItems.map((w) => w.reporter?.accountId).filter((x): x is string => Boolean(x)),
      ...peerWork.map((p) => p.accountId),
      ...graph.teammates.map((t) => t.accountId),
    ]),
  ]
    .filter((id) => id !== o.personId && isAccountId(id))
    .slice(0, MAX_CANDIDATES);

  let openLoad: Record<string, number> = {};
  if (candidateIds.length) {
    try {
      openLoad = await openLoadOf(candidateIds);
    } catch {
      // Older sites without the count endpoint: one shared search, which can undercount.
      try {
        const loadIssues = await searchIssues(
          `assignee in (${quoteIds(candidateIds)}) AND statusCategory != Done`,
          ['assignee'],
          300,
        );
        openLoad = countByAssignee(loadIssues);
      } catch (e) {
        notes.push(`Could not read stand-ins' current load: ${message(e)}`);
      }
    }
  }

  let openTotal: number | undefined;
  if (rawItems.length >= MAX_ITEMS) {
    openTotal = await approximateCount(`assignee = "${o.personId}" AND statusCategory != Done`).catch(() => undefined);
    notes.push(`${person.displayName} has more open items than Understudy reads at once; the plan covers the ${MAX_ITEMS} most urgent.`);
  }

  return {
    person,
    absence: o.absence,
    today: o.today,
    siteUrl,
    workItems,
    pullRequests: graph.pullRequests,
    goals: graph.goals,
    pages,
    teammates: graph.teammates,
    peerWork,
    openLoad,
    openTotal,
    sources,
  };
}
