// The four things Understudy does, shared by the Jira page (resolvers) and
// the Rovo agent / MCP tools (actions), so both always give the same answer.
import { buildBrief, type Brief } from './core/brief';
import { settleBy } from './core/budget';
import { addDays, checkAbsenceInput, dayInput, normaliseAbsence, returnSince, todayIn } from './core/dates';
import { isPlainMessage, userMessage } from './core/errors';
import { parseStandInChoices } from './core/choices';
import { RISK_LABELS, assessRisk } from './core/risk';
import { renderHandoverPage, standInComment, walkthroughComment } from './core/render';
import { TEAM_RISK_LABELS, buildTeamRisk, type TeamRisk } from './core/team';
import { rankStandIns, type Candidate } from './core/standins';
import type { Absence, Person, Snapshot, WorkItem } from './core/types';
import {
  addComment,
  addWatcher,
  updateComment,
  createPage,
  findPeople,
  getIssueRaw,
  getMyTimeZone,
  getMyself,
  getPerson,
  listProjects,
  listSpaces,
  searchIssues,
  spaceByKey,
} from './adapters/atlassian';
import { gatherReturn, gatherSnapshot, gatherTeam } from './adapters/gather';
import { buildWelcomeBack, type WelcomeBack } from './core/handback';
import { findBriefing, isAccountId, isIssueKey, parseIssue, parsePersonResponse } from './adapters/parse';

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
  /** Who is asking, when known. */
  requesterId?: string;
  /** Work items to leave out, such as the time-off item itself. */
  excludeKeys?: string[];
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
    requesterId: req.requesterId,
    excludeKeys: req.excludeKeys,
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

export { listProjects, listSpaces };

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
export async function standInsForItem(issueKey: string, cloudId: string | undefined, requesterId?: string): Promise<ItemStandIns> {
  const [raw, today] = await Promise.all([getIssueRaw(issueKey), requesterToday()]);
  const item = parseIssue(raw);
  if (!item) throw new Error(`Could not read ${issueKey}.`);
  const ref = { key: item.key, summary: item.summary, url: item.url };
  const owner = parsePersonResponse(raw?.fields?.assignee);
  if (!owner) return { unassigned: true, item: ref, message: NO_ASSIGNEE };

  const { brief, snapshot } = await prepare({ personId: owner.accountId, cloudId, person: owner, today, focus: item, requesterId });
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
  /** Who is asking: a briefing they already posted for this stand-in is updated, not repeated. */
  requesterId?: string;
}

/** Comments on the item to brief the stand-in, and adds them as a watcher. */
export async function notifyStandIn(
  r: NotifyRequest,
): Promise<{ commentId?: string; watching: boolean; updated: boolean; message: string }> {
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
    requesterId: r.requesterId,
  });
  const entry = brief.items.find((b) => b.item.key === item.key);
  const known = entry && [entry.standIn, ...entry.alternatives].find((c) => c?.accountId === r.standIn.accountId);

  const body = standInComment({
    itemKey: item.key,
    standIn: r.standIn,
    ownerName: owner.displayName,
    absence: r.start || r.end ? absence : undefined,
    whyItMatters: entry ? entry.risk.flags.map((f) => RISK_LABELS[f]) : [],
    because: known ? known.reasons.filter((x) => x.points > 0).map((x) => x.text) : [],
    note: r.note,
  });
  // Briefing the same stand-in again (new dates, a better note) edits the
  // earlier comment, so the work item never shows two briefings for one person.
  const earlier = findBriefing(raw, r.standIn.accountId);
  const mine = earlier && r.requesterId && earlier.authorId === r.requesterId ? earlier : undefined;
  const { commentId, updated } = await postOrUpdate(item.key, mine?.id, body);
  const watching = await addWatcher(item.key, r.standIn.accountId);
  const verb = updated ? 'Updated the briefing for' : 'Briefed';
  return {
    commentId,
    watching,
    updated,
    message: `${verb} ${r.standIn.displayName} on ${item.key}${watching ? ' and added them as a watcher' : ''}.`,
  };
}

// ---- Team knowledge risk ----

/** Without projects, the team view looks at the projects of the asker's own open work. */
export async function projectsOf(accountId: string, max = 3): Promise<string[]> {
  if (!isAccountId(accountId)) return [];
  const raw = await searchIssues(`assignee = "${accountId}" AND statusCategory != Done ORDER BY updated DESC`, ['project'], 50);
  const counts = new Map<string, number>();
  for (const r of raw) {
    const key = r?.fields?.project?.key;
    if (typeof key === 'string') counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/** Which open work in these projects only one person understands, and who should learn it. */
export async function teamRisk(projects: string[], today?: string): Promise<TeamRisk> {
  const day = today ?? (await requesterToday());
  return buildTeamRisk(await gatherTeam(projects, day));
}

export interface WalkthroughRequest {
  issueKey: string;
  learner: Person;
  note?: string;
}

/**
 * Asks the owner of a work item, in a comment, to walk a colleague through it,
 * and adds the colleague as a watcher. Never reassigns anything.
 */
export async function requestWalkthrough(r: WalkthroughRequest): Promise<{ commentId?: string; watching: boolean; message: string }> {
  if (!isIssueKey(r.issueKey)) throw new Error(`${r.issueKey} is not a Jira work item key.`);
  const [raw, today] = await Promise.all([getIssueRaw(r.issueKey), requesterToday()]);
  const item = parseIssue(raw);
  if (!item) throw new Error(`Could not read ${r.issueKey}.`);
  const owner = parsePersonResponse(raw?.fields?.assignee);
  if (!owner) throw new Error(`${item.key} has no assignee, so there is nobody to give a walkthrough yet.`);
  if (owner.accountId === r.learner.accountId) throw new Error(`${r.learner.displayName} already owns ${item.key}.`);
  if (isRecentWalkthrough(item.walkthrough, r.learner.accountId, today)) {
    const watching = await addWatcher(item.key, r.learner.accountId);
    return { watching, message: `A walkthrough of ${item.key} for ${r.learner.displayName} was already requested in the last two weeks.` };
  }
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10);
  const risk = assessRisk(item, owner.accountId, { start: today, end }, today);
  const commentId = await addComment(
    item.key,
    walkthroughComment({
      itemKey: item.key,
      owner,
      learner: r.learner,
      whyItMatters: risk.flags.map((f) => TEAM_RISK_LABELS[f]),
      note: r.note,
    }),
  );
  const watching = await addWatcher(item.key, r.learner.accountId);
  return {
    commentId,
    watching,
    message: `Asked ${owner.displayName} to walk ${r.learner.displayName} through ${item.key}${watching ? ', and added them as a watcher' : ''}.`,
  };
}

// ---- Choices made in chat, and briefing everyone at once ----

/**
 * Stand-ins a person chose in chat ("PAY-3=Max Taylor; PAY-5: Cassi"), as
 * issue key -> account ID. Each name is resolved like any other person input,
 * so an ambiguous name is an error with the options, never a guess.
 */
export async function overridesFrom(text: unknown, requesterId?: string): Promise<Record<string, string>> {
  const choices = parseStandInChoices(text).slice(0, MAX_CHAT_CHOICES);
  const names = [...new Set(choices.map((c) => c.who))];
  const people = await Promise.all(names.map((who) => resolvePerson(who, requesterId)));
  const idOf = new Map(names.map((who, i) => [who, people[i]!.accountId]));
  return Object.fromEntries(choices.map((c) => [c.key, idOf.get(c.who)!]));
}

/** Stand-ins changed in one chat: more than this is a new plan, not a few swaps. */
const MAX_CHAT_CHOICES = 15;

/**
 * Updates an earlier briefing when there is one this person may edit, and
 * posts a new comment otherwise, including when the edit is refused (the
 * comment was deleted, or permissions changed since it was read).
 */
async function postOrUpdate(key: string, earlierId: string | undefined, body: Parameters<typeof addComment>[1]) {
  if (earlierId) {
    try {
      return { commentId: await updateComment(key, earlierId, body), updated: true };
    } catch (e) {
      console.warn(`[understudy] could not update briefing on ${key}, posting a new one`, userMessage(e));
    }
  }
  return { commentId: await addComment(key, body), updated: false };
}

/** A walkthrough asked for this colleague within the last two weeks. */
export function isRecentWalkthrough(w: WorkItem['walkthrough'], learnerId: string, today: string): boolean {
  return Boolean(w && w.learnerId === learnerId && w.at.slice(0, 10) >= addDays(today, -14));
}

/** Most briefings one call sends; the rest are listed so the page can finish them. */
export const MAX_BULK_BRIEFINGS = 12;
/** Stop starting new briefings after this long, well inside Forge's 25 seconds. */
const BULK_BUDGET_MS = 12_000;

export interface BriefAllRequest {
  personId: string;
  person?: Person;
  start?: unknown;
  end?: unknown;
  cloudId?: string;
  overrides?: Record<string, string>;
  note?: string;
  requesterId?: string;
}

export interface BriefAllResult {
  briefed: { key: string; standIn: string; updated: boolean }[];
  skipped: { key: string; reason: string }[];
  message: string;
}

/**
 * Briefs every stand-in in the plan in one go: one comment per work item
 * (updating an earlier briefing for the same person), and a watcher. Items
 * with no stand-in are reported, never guessed.
 */
export async function briefAllStandIns(r: BriefAllRequest): Promise<BriefAllResult> {
  const started = Date.now();
  const { brief, absence } = await prepare({
    personId: r.personId,
    person: r.person,
    start: r.start,
    end: r.end,
    cloudId: r.cloudId,
    overrides: r.overrides,
    requesterId: r.requesterId,
  });
  const briefed: BriefAllResult['briefed'] = [];
  const skipped: BriefAllResult['skipped'] = [];
  for (const b of brief.items.filter((x) => x.risk.tier !== 'can-wait')) {
    if (!b.standIn) {
      skipped.push({ key: b.item.key, reason: 'No stand-in: nobody else has enough context. Book a walkthrough or choose someone.' });
      continue;
    }
    if (briefed.length >= MAX_BULK_BRIEFINGS || Date.now() - started > BULK_BUDGET_MS) {
      skipped.push({ key: b.item.key, reason: 'Not sent yet: brief this one from the Understudy page.' });
      continue;
    }
    try {
      const raw = await getIssueRaw(b.item.key);
      const body = standInComment({
        itemKey: b.item.key,
        standIn: b.standIn,
        ownerName: brief.person.displayName,
        absence,
        whyItMatters: b.risk.flags.map((f) => RISK_LABELS[f]),
        because: b.standIn.reasons.filter((x) => x.points > 0).map((x) => x.text),
        note: r.note,
      });
      const earlier = findBriefing(raw, b.standIn.accountId);
      const mine = earlier && r.requesterId && earlier.authorId === r.requesterId ? earlier : undefined;
      const { updated } = await postOrUpdate(b.item.key, mine?.id, body);
      await addWatcher(b.item.key, b.standIn.accountId);
      briefed.push({ key: b.item.key, standIn: b.standIn.displayName, updated });
    } catch (e) {
      skipped.push({ key: b.item.key, reason: userMessage(e) });
    }
  }
  const people = new Set(briefed.map((x) => x.standIn)).size;
  const main = briefed.length
    ? `Briefed ${people} stand-in${people === 1 ? '' : 's'} on ${briefed.length} work item${briefed.length === 1 ? '' : 's'}.`
    : 'No stand-ins were briefed.';
  return { briefed, skipped, message: skipped.length ? `${main} ${skipped.length} not sent: see skipped.` : main };
}
