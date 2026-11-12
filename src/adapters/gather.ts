// Collects one person's work context from Jira, Confluence and Teamwork
// Graph. Each source can fail on its own; the snapshot says which ones
// answered so the UI and the agent can be honest about gaps.
import { pause, settleBy, type Settled } from '../core/budget';
import { isIsoDay } from '../core/dates';
import { userMessage } from '../core/errors';
import type { ReturnItem } from '../core/handback';
import type { OwnedItem, TeamSnapshot } from '../core/team';
import type { Absence, Page, Person, Snapshot, Sources, WorkItem } from '../core/types';
import { ApiError, ISSUE_FIELDS, approximateCount, getPerson, recentPagesBy, searchIssues } from './atlassian';
import {
  countByAssignee,
  isAccountId,
  isActivePerson,
  isProjectKey,
  parseIssue,
  parsePeerWork,
  parsePersonResponse,
  parseReturnIssue,
  quoteIds,
  siteFromSelf,
} from './parse';
import { readGraph, type GraphContext } from './twg';

const MAX_ITEMS = 100;
const MAX_PEER_ITEMS = 200;
const MAX_CANDIDATES = 30;
const COUNT_BATCH = 10;
/** Welcome back reads this many of the most recently updated work items. */
export const MAX_RETURN_ITEMS = 50;
/**
 * Forge stops a function after 25 seconds. The optional sources (teammates'
 * work, Confluence, Teamwork Graph, load counts) share this budget; whatever
 * has not answered by then is left out with a note instead of failing.
 */
export const OPTIONAL_BUDGET_MS = 18_000;
/** Longest wait before the one retry of a rate-limited count. */
const MAX_RETRY_WAIT_MS = 3_000;

type SearchResult = Awaited<ReturnType<typeof searchIssues>>;

/** One person's open items, retried once when Atlassian rate-limits the request. */
async function countOpenItems(accountId: string): Promise<number> {
  const jql = `assignee = "${accountId}" AND statusCategory != Done`;
  try {
    return await approximateCount(jql);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 429) throw e;
    await pause(Math.min(MAX_RETRY_WAIT_MS, e.retryAfterMs ?? 1_000));
    return approximateCount(jql);
  }
}

/**
 * Open items per person, one count each. A single shared search would let one
 * very busy person use up the result limit and make everyone else look idle.
 * A count that fails leaves out only that person; when every count fails the
 * error is thrown, so the caller can fall back.
 */
async function openLoadOf(ids: string[]): Promise<{ counts: Record<string, number>; missing: number }> {
  const counts: Record<string, number> = {};
  let missing = 0;
  let lastError: unknown;
  for (let i = 0; i < ids.length; i += COUNT_BATCH) {
    const batch = ids.slice(i, i + COUNT_BATCH);
    const results = await Promise.allSettled(batch.map(countOpenItems));
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        counts[batch[j]!] = r.value;
      } else {
        missing += 1;
        lastError = r.reason;
      }
    });
  }
  if (ids.length > 0 && missing === ids.length) throw lastError;
  return { counts, missing };
}

/** Load per possible stand-in, with a note when some or all of it could not be read. */
export async function loadOf(ids: string[]): Promise<{ counts: Record<string, number>; note?: string }> {
  try {
    const { counts, missing } = await openLoadOf(ids);
    return missing
      ? { counts, note: `Could not read how much ${missing} of ${ids.length} possible stand-ins already carry, so their open items are not counted.` }
      : { counts };
  } catch {
    // Older sites without the count endpoint: one shared search, which can undercount.
    try {
      const loadIssues = await searchIssues(`assignee in (${quoteIds(ids)}) AND statusCategory != Done`, ['assignee'], 300);
      return { counts: countByAssignee(loadIssues) };
    } catch (e) {
      return { counts: {}, note: `Could not read stand-ins' current load: ${userMessage(e)}` };
    }
  }
}

/** Forge errors that mean the app may not use Confluence here at all. */
const NOT_CONNECTED_ERRORS = new Set(['REQUEST_EGRESS_ALLOWLIST_ERR', 'NEEDS_AUTHENTICATION_ERR']);

/** Tells "Confluence is not connected" apart from "Confluence did not answer properly". */
export function confluenceNote(r: Settled<unknown>): string {
  if (r.state === 'timeout') return 'Confluence took too long to answer, so pages are left out.';
  const e = r.state === 'error' ? r.error : undefined;
  const notConnected =
    e instanceof ApiError ? e.status === 401 || e.status === 404 : e instanceof Error && NOT_CONNECTED_ERRORS.has(e.name);
  if (notConnected) return 'Confluence is not connected. Connect Understudy to Confluence to include pages and publish handovers.';
  if (e instanceof ApiError) return `Confluence could not be read (status ${e.status}), so pages are left out.`;
  return 'Confluence could not be read, so pages are left out.';
}

export interface GatherOptions {
  personId: string;
  absence: Absence;
  today: string;
  cloudId?: string;
  /** Skip the person lookup when the caller already has it. */
  person?: Person;
  /**
   * The one work item the answer is about (issue panel, a stand-in briefing).
   * It is always included, Confluence is not read, and the person's other
   * work becomes optional, so suggestions survive a slow or failing search.
   */
  focus?: WorkItem;
  /** Milliseconds the optional sources may take in total. */
  budgetMs?: number;
  /** Who is asking: their teams help find the person's teams in Teamwork Graph. */
  requesterId?: string;
  /** Work items to leave out of the plan, such as the time-off item itself. */
  excludeKeys?: string[];
}

export interface ReturnGather {
  items: ReturnItem[];
  /** What was skipped or capped, in plain words. */
  notes: string[];
}

/**
 * Work the person owns, reported or watches that others touched since the
 * absence began, with each item's changelog and comments.
 */
export async function gatherReturn(personId: string, since: string): Promise<ReturnGather> {
  if (!isAccountId(personId)) throw new Error('A valid account ID is required.');
  if (!isIsoDay(since)) throw new Error('The first day away must be a date like 2026-12-01.');
  const notes: string[] = [];
  const search = (watched: boolean) =>
    searchIssues(
      `(assignee = "${personId}" OR reporter = "${personId}"${watched ? ` OR watcher = "${personId}"` : ''}) AND updated >= "${since}" ORDER BY updated DESC`,
      ['summary', 'status', 'assignee', 'updated', 'comment'],
      MAX_RETURN_ITEMS,
      'changelog',
    );
  let raw: SearchResult;
  try {
    raw = await search(true);
  } catch (e) {
    // Jira refuses "watcher =" for someone else unless you may see their watchers.
    if (!(e instanceof ApiError) || (e.status !== 400 && e.status !== 403)) throw e;
    raw = await search(false);
    notes.push('Watched work items were skipped because Jira did not allow searching them. Items they own or reported are included.');
  }
  if (raw.length >= MAX_RETURN_ITEMS) notes.push(`Showing the ${MAX_RETURN_ITEMS} most recent changes.`);
  return { items: raw.map((r) => parseReturnIssue(r, personId, since)).filter((x): x is ReturnItem => Boolean(x)), notes };
}

const emptyGraph = (note: string): GraphContext => ({
  pullRequests: [],
  goals: [],
  teammates: [],
  itemPullRequests: {},
  state: 'unavailable',
  notes: [note],
});

export async function gatherSnapshot(o: GatherOptions): Promise<Snapshot> {
  if (!isAccountId(o.personId)) throw new Error('A valid account ID is required.');
  const deadline = Date.now() + (o.budgetMs ?? OPTIONAL_BUDGET_MS);
  const notes: string[] = [];
  const sources: Sources = { jira: 'ok', confluence: 'ok', teamworkGraph: 'unavailable', notes };
  const focus = o.focus;

  const person = o.person ?? (await getPerson(o.personId));
  const ownWork = () =>
    searchIssues(`assignee = "${o.personId}" AND statusCategory != Done ORDER BY priority DESC, duedate ASC`, ISSUE_FIELDS, MAX_ITEMS);
  let rawItems: SearchResult = [];
  if (focus) {
    const own = await settleBy(deadline, ownWork);
    if (own.state === 'ok') rawItems = own.value;
    else if (own.state === 'timeout') notes.push(`${person.displayName}'s other open work took too long to read, so suggestions for ${focus.key} use that item alone.`);
    else notes.push(`Could not read ${person.displayName}'s other open work, so suggestions for ${focus.key} use that item alone. ${userMessage(own.error)}`);
  } else {
    rawItems = await ownWork();
  }
  const excluded = new Set(o.excludeKeys ?? []);
  const workItems = rawItems
    .map(parseIssue)
    .filter((w): w is NonNullable<typeof w> => Boolean(w))
    .filter((w) => !excluded.has(w.key));
  if (workItems.length === 0) sources.jira = 'empty';
  const siteUrl = siteFromSelf(rawItems[0]?.self) ?? (focus ? siteFromSelf(focus.url) : undefined);
  if (focus && !workItems.some((w) => w.key === focus.key)) workItems.push(focus);
  // Teamwork Graph reads linked pull requests for the first items: put the focus first.
  const graphItems = focus ? [focus, ...workItems.filter((w) => w.key !== focus.key)] : workItems;

  const projects = [...new Set(workItems.map((w) => w.projectKey))].filter(isProjectKey).slice(0, 10);

  const [peerRes, pagesRes, graphRes] = await Promise.all([
    projects.length
      ? settleBy(deadline, () =>
          searchIssues(
            `project in (${projects.join(', ')}) AND assignee is not EMPTY AND assignee != "${o.personId}" AND updated >= -90d ORDER BY updated DESC`,
            ['assignee', 'project', 'parent', 'labels', 'components', 'updated'],
            MAX_PEER_ITEMS,
          ),
        )
      : Promise.resolve<Settled<SearchResult>>({ state: 'ok', value: [] }),
    // Pages are not needed to cover one work item, so the issue panel skips Confluence.
    focus ? Promise.resolve(undefined) : settleBy(deadline, () => recentPagesBy(o.personId)),
    settleBy(deadline, () => readGraph(o.personId, graphItems, o.cloudId, o.requesterId)),
  ]);

  const peerWork = peerRes.state === 'ok' ? peerRes.value.map(parsePeerWork).filter((p): p is NonNullable<typeof p> => Boolean(p)) : [];
  if (peerRes.state === 'timeout') notes.push("Teammates' recent work took too long to read, so it is left out.");
  if (peerRes.state === 'error') notes.push(`Could not read teammates' recent work: ${userMessage(peerRes.error)}`);

  let pages: Page[] = [];
  if (!pagesRes) {
    sources.confluence = 'unavailable';
  } else if (pagesRes.state === 'ok') {
    pages = pagesRes.value;
    if (pages.length === 0) sources.confluence = 'empty';
  } else {
    sources.confluence = 'unavailable';
    notes.push(confluenceNote(pagesRes));
  }

  const graph =
    graphRes.state === 'ok'
      ? graphRes.value
      : emptyGraph(
          graphRes.state === 'timeout'
            ? 'Teamwork Graph took too long to answer, so teams, goals and pull requests are left out.'
            : `Teamwork Graph could not be read: ${userMessage(graphRes.error)}`,
        );
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
    const load = await settleBy(deadline, () => loadOf(candidateIds));
    if (load.state === 'ok') {
      openLoad = load.value.counts;
      if (load.value.note) notes.push(load.value.note);
    } else if (load.state === 'timeout') {
      notes.push("Stand-ins' current load took too long to read, so it is not counted.");
    } else {
      notes.push(`Could not read stand-ins' current load: ${userMessage(load.error)}`);
    }
  }

  let openTotal: number | undefined;
  if (rawItems.length >= MAX_ITEMS) {
    const total = await settleBy(deadline, () => approximateCount(`assignee = "${o.personId}" AND statusCategory != Done`));
    openTotal = total.state === 'ok' ? total.value : undefined;
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

/** The team view reads at most this many open items, the most urgent first. */
export const MAX_TEAM_ITEMS = 100;
/** And this many recently updated items to learn who has worked where. */
const MAX_TEAM_PEER_ITEMS = 300;
const MAX_TEAM_PROJECTS = 5;

/**
 * Open assigned work in up to five projects, with the recent work that shows
 * who else knows it. Reading load is optional and shares the time budget.
 */
export async function gatherTeam(projects: string[], today: string, budgetMs = OPTIONAL_BUDGET_MS): Promise<TeamSnapshot> {
  const keys = [...new Set(projects.map((p) => p.trim().toUpperCase()))].filter(isProjectKey).slice(0, MAX_TEAM_PROJECTS);
  if (keys.length === 0) throw new Error('Choose at least one Jira project.');
  const deadline = Date.now() + budgetMs;
  const notes: string[] = [];
  // Quoted, so a project whose key is a JQL word (such as IN or OR) still works.
  const scope = `project in (${keys.map((k) => `"${k}"`).join(', ')})`;

  const [main, peerRes] = await Promise.all([
    settleBy(deadline, () =>
      searchIssues(
        `${scope} AND statusCategory != Done AND assignee is not EMPTY ORDER BY priority DESC, duedate ASC`,
        [...ISSUE_FIELDS, 'assignee'],
        MAX_TEAM_ITEMS,
      ),
    ),
    settleBy(deadline, () =>
      searchIssues(
        `${scope} AND assignee is not EMPTY AND updated >= -90d ORDER BY updated DESC`,
        ['assignee', 'project', 'parent', 'labels', 'components', 'updated'],
        MAX_TEAM_PEER_ITEMS,
      ),
    ),
  ]);

  if (main.state === 'timeout') throw new Error('Jira took too long to list the open work in these projects. Try fewer projects.');
  if (main.state === 'error') throw main.error;
  const raw = main.value;
  const items: OwnedItem[] = [];
  for (const r of raw) {
    const item = parseIssue(r);
    const owner = isActivePerson(r?.fields?.assignee) ? parsePersonResponse(r.fields.assignee) : undefined;
    if (item && owner) items.push({ item, owner });
  }

  const peerWork = peerRes.state === 'ok' ? peerRes.value.map(parsePeerWork).filter((p): p is NonNullable<typeof p> => Boolean(p)) : [];
  if (peerRes.state === 'timeout') notes.push('Recent work in these projects took too long to read, so only comments count as context.');
  if (peerRes.state === 'error') notes.push(`Could not read recent work in these projects: ${userMessage(peerRes.error)}`);

  // Load matters less here than in a handover (nothing is assigned), but it
  // keeps "who could cover" honest about people who are already stretched.
  const ids = [
    ...new Set([
      ...items.flatMap((o) => o.item.comments.map((c) => c.accountId)),
      ...peerWork.map((p) => p.accountId),
      ...items.map((o) => o.owner.accountId),
    ]),
  ]
    .filter(isAccountId)
    .slice(0, MAX_CANDIDATES);
  let openLoad: Record<string, number> = {};
  if (ids.length) {
    const load = await settleBy(deadline, () => loadOf(ids));
    if (load.state === 'ok') {
      openLoad = load.value.counts;
      if (load.value.note) notes.push(load.value.note);
    } else {
      notes.push(load.state === 'timeout' ? "People's current load took too long to read, so it is not counted." : `Could not read people's current load: ${userMessage(load.error)}`);
    }
  }

  let openTotal: number | undefined;
  if (raw.length >= MAX_TEAM_ITEMS) {
    const total = await settleBy(deadline, () => approximateCount(`${scope} AND statusCategory != Done AND assignee is not EMPTY`));
    openTotal = total.state === 'ok' ? total.value : undefined;
    notes.push(`These projects have more open items than Understudy reads at once; this view checks the ${MAX_TEAM_ITEMS} most urgent.`);
  }

  return { projects: keys, today, items, peerWork, openLoad, openTotal, notes };
}
