// The four things Understudy does, shared by the Jira page (resolvers) and
// the Rovo agent / MCP tools (actions), so both always give the same answer.
import { buildBrief, type Brief } from './core/brief';
import { settleBy } from './core/budget';
import { checkAbsenceInput, dayInput, normaliseAbsence, returnSince, todayIn } from './core/dates';
import { isPlainMessage, userMessage } from './core/errors';
import { RISK_LABELS } from './core/risk';
import { renderHandoverPage, standInComment } from './core/render';
import { rankStandIns, type Candidate } from './core/standins';
import type { Absence, Person, Snapshot, WorkItem } from './core/types';
import {
  addComment,
  addWatcher,
  createPage,
  findPeople,
  getIssueRaw,
  getMyTimeZone,
  getMyself,
  getPerson,
  listSpaces,
  spaceByKey,
} from './adapters/atlassian';
import { gatherReturn, gatherSnapshot } from './adapters/gather';
import { buildWelcomeBack, type WelcomeBack } from './core/handback';
import { isAccountId, isIssueKey, parseIssue, parsePersonResponse } from './adapters/parse';

/** The time zone is a nicety: never wait long for it. */
const TIME_ZONE_BUDGET_MS = 3_000;

/**
 * Today's date for the person asking, in the time zone of their Jira profile
 * (/rest/api/3/myself, read:jira-user). UTC when Jira does not say or is slow.
 */
export async function requesterToday(): Promise<string> {
  const zone = await settleBy(Date.now() + TIME_ZONE_BUDGET_MS, () => getMyTimeZone());
  return todayIn(zone.state === 'ok' ? zone.value : undefined);
}

/**
 * The { error } the page and Rovo show: always plain words. Anything
 * unexpected is logged in full for `forge logs`; API errors were logged with
 * Atlassian's raw answer when they happened.
 */
export function failure(e: unknown, where: string): { error: string } {
  if (!isPlainMessage(e)) console.error(`[understudy] ${where} failed`, e);
  return { error: userMessage(e) };
}

const SELF_WORDS = new Set(['', 'me', 'myself', 'i', 'yo', 'my', 'mine']);
const MAX_NAMES_LISTED = 5;

/** Several people match: name up to five, and ask for something that picks exactly one. */
export function severalPeopleMessage(text: string, matches: Person[]): string {
  const shown = matches.slice(0, MAX_NAMES_LISTED);
  const counts = new Map<string, number>();
  for (const p of shown) counts.set(p.displayName, (counts.get(p.displayName) ?? 0) + 1);
  // Two people with the same name can only be told apart by their account IDs.
  const names = shown.map((p) => ((counts.get(p.displayName) ?? 0) > 1 ? `${p.displayName} (account ID ${p.accountId})` : p.displayName));
  const more = matches.length > shown.length ? ` and ${matches.length - shown.length} more` : '';
  return `"${text}" matches several people: ${names.join(', ')}${more}. Give their email address or account ID to pick one.`;
}

/**
 * Turns whatever a person or an agent typed ("me", a name, an email, an
 * account ID) into one Atlassian user. Ambiguous names are an error with the
 * options, never a guess.
 */
export async function resolvePerson(input: unknown, requesterId: string | undefined): Promise<Person> {
  const text = typeof input === 'string' ? input.trim() : '';
  if (SELF_WORDS.has(text.toLowerCase())) {
    return requesterId && isAccountId(requesterId) ? getPerson(requesterId) : getMyself();
  }
  if (isAccountId(text) && (text.includes(':') || /^[0-9a-f]{24}$/i.test(text))) return getPerson(text);
  const matches = await findPeople(text, 10);
  const exact = matches.filter((p) => p.displayName.toLowerCase() === text.toLowerCase());
  if (exact.length === 1) return exact[0]!;
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`No active user matches "${text}".`);
  throw new Error(severalPeopleMessage(text, exact.length > 1 ? exact : matches));
}

export interface BriefRequest {
  personId: string;
  start?: unknown;
  end?: unknown;
  cloudId?: string;
  overrides?: Record<string, string>;
  person?: Person;
  /** Today for the person asking; read from their Jira time zone when left out. */
  today?: string;
  /** The one work item the answer is about (issue panel, stand-in briefing). */
  focus?: WorkItem;
}

export async function prepare(req: BriefRequest): Promise<{ brief: Brief; snapshot: Snapshot; absence: Absence }> {
  checkAbsenceInput(req.start, req.end); // a wrong date fails before any slow work
  const today = req.today ?? (await requesterToday());
  const absence = normaliseAbsence(req.start, req.end, today);
  const snapshot = await gatherSnapshot({
    personId: req.personId,
    absence,
    today,
    cloudId: req.cloudId,
    person: req.person,
    focus: req.focus,
  });
  const overrides = Object.fromEntries(
    Object.entries(req.overrides ?? {}).filter(([k, v]) => isIssueKey(k) && isAccountId(v)),
  );
  return { brief: buildBrief(snapshot, overrides), snapshot, absence };
}

/** What changed on someone's work since they left. Defaults to the last 14 days; never a future day. */
export async function welcomeBack(person: Person, since: unknown, today?: string): Promise<WelcomeBack> {
  dayInput(since); // a wrong date fails before any slow work
  const day = today ?? (await requesterToday());
  const from = returnSince(since, day);
  const { items, notes } = await gatherReturn(person.accountId, from);
  return buildWelcomeBack(items, person, from, day, notes);
}

export async function publish(brief: Brief, space: { id?: string; key?: string }): Promise<{ url: string; title: string }> {
  let spaceId = space.id;
  if (!spaceId && space.key) spaceId = (await spaceByKey(space.key))?.id;
  if (!spaceId) throw new Error('Choose a Confluence space to publish the handover in.');
  const page = renderHandoverPage(brief);
  const created = await createPage(spaceId, page.title, page.body);
  return { url: created.url, title: page.title };
}

export { listSpaces };

export const NO_ASSIGNEE = 'This work item has no assignee, so there is nobody to cover for yet. Assign it to someone to see who could stand in.';

export interface ItemRef {
  key: string;
  summary: string;
  url: string;
}

export type ItemStandIns =
  | { unassigned: false; owner: Person; item: ItemRef; candidates: Candidate[]; brief: Brief }
  | { unassigned: true; item: ItemRef; message: string };

/** Ranks stand-ins for a single work item, from its assignee's context. */
export async function standInsForItem(issueKey: string, cloudId: string | undefined): Promise<ItemStandIns> {
  const [raw, today] = await Promise.all([getIssueRaw(issueKey), requesterToday()]);
  const item = parseIssue(raw);
  if (!item) throw new Error(`Could not read ${issueKey}.`);
  const ref = { key: item.key, summary: item.summary, url: item.url };
  const owner = parsePersonResponse(raw?.fields?.assignee);
  if (!owner) return { unassigned: true, item: ref, message: NO_ASSIGNEE };

  const { brief, snapshot } = await prepare({ personId: owner.accountId, cloudId, person: owner, today, focus: item });
  const target = snapshot.workItems.find((w) => w.key === item.key) ?? item;
  const candidates = rankStandIns(
    target,
    { personId: owner.accountId, teammates: snapshot.teammates, peerWork: snapshot.peerWork, openLoad: snapshot.openLoad },
    {},
    5,
  );
  return { unassigned: false, owner, item: ref, candidates, brief };
}

export interface NotifyRequest {
  issueKey: string;
  standIn: Person;
  cloudId?: string;
  start?: unknown;
  end?: unknown;
  note?: string;
}

/** Comments on the item to brief the stand-in, and adds them as a watcher. */
export async function notifyStandIn(r: NotifyRequest): Promise<{ commentId?: string; watching: boolean; message: string }> {
  if (!isIssueKey(r.issueKey)) throw new Error(`${r.issueKey} is not a Jira work item key.`);
  checkAbsenceInput(r.start, r.end);
  const [raw, today] = await Promise.all([getIssueRaw(r.issueKey), requesterToday()]);
  const item = parseIssue(raw);
  if (!item) throw new Error(`Could not read ${r.issueKey}.`);
  const owner = parsePersonResponse(raw?.fields?.assignee);
  if (!owner) throw new Error(`${item.key} has no assignee, so there is nobody to cover for yet. Assign it before briefing a stand-in.`);
  if (owner.accountId === r.standIn.accountId) throw new Error(`${r.standIn.displayName} already owns ${item.key}.`);

  const { brief, absence } = await prepare({
    personId: owner.accountId,
    start: r.start,
    end: r.end,
    cloudId: r.cloudId,
    person: owner,
    today,
    focus: item,
  });
  const entry = brief.items.find((b) => b.item.key === item.key);
  const known = entry && [entry.standIn, ...entry.alternatives].find((c) => c?.accountId === r.standIn.accountId);

  const commentId = await addComment(
    item.key,
    standInComment({
      itemKey: item.key,
      standIn: r.standIn,
      ownerName: owner.displayName,
      absence: r.start || r.end ? absence : undefined,
      whyItMatters: entry ? entry.risk.flags.map((f) => RISK_LABELS[f]) : [],
      because: known ? known.reasons.filter((x) => x.points > 0).map((x) => x.text) : [],
      note: r.note,
    }),
  );
  const watching = await addWatcher(item.key, r.standIn.accountId);
  return {
    commentId,
    watching,
    message: `Briefed ${r.standIn.displayName} on ${item.key}${watching ? ' and added them as a watcher' : ''}.`,
  };
}
