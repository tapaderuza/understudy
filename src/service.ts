// The four things Understudy does, shared by the Jira page (resolvers) and
// the Rovo agent / MCP tools (actions), so both always give the same answer.
import { buildBrief, type Brief } from './core/brief';
import { normaliseAbsence, toIsoDay } from './core/dates';
import { RISK_LABELS } from './core/risk';
import { renderHandoverPage, standInComment } from './core/render';
import { rankStandIns, type Candidate } from './core/standins';
import type { Absence, Person, Snapshot } from './core/types';
import { addComment, addWatcher, createPage, findPeople, getIssueRaw, getMyself, getPerson, listSpaces, spaceByKey } from './adapters/atlassian';
import { gatherReturn, gatherSnapshot } from './adapters/gather';
import { buildWelcomeBack, type WelcomeBack } from './core/handback';
import { addDays, isIsoDay } from './core/dates';
import { isAccountId, isIssueKey, parseIssue, parsePersonResponse } from './adapters/parse';

export const todayIso = () => toIsoDay(new Date());

const SELF_WORDS = new Set(['', 'me', 'myself', 'i', 'yo', 'my', 'mine']);

/**
 * Turns whatever a person or an agent typed ("me", a name, an account ID)
 * into one Atlassian user. Ambiguous names are an error with the options,
 * never a guess.
 */
export async function resolvePerson(input: unknown, requesterId: string | undefined): Promise<Person> {
  const text = typeof input === 'string' ? input.trim() : '';
  if (SELF_WORDS.has(text.toLowerCase())) {
    return requesterId && isAccountId(requesterId) ? getPerson(requesterId) : getMyself();
  }
  if (isAccountId(text) && (text.includes(':') || /^[0-9a-f]{24}$/i.test(text))) return getPerson(text);
  const matches = await findPeople(text, 5);
  const exact = matches.filter((p) => p.displayName.toLowerCase() === text.toLowerCase());
  if (exact.length === 1) return exact[0]!;
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`No active user matches "${text}".`);
  throw new Error(`"${text}" matches several people: ${matches.map((m) => m.displayName).join(', ')}. Which one?`);
}

export interface BriefRequest {
  personId: string;
  start?: unknown;
  end?: unknown;
  cloudId?: string;
  overrides?: Record<string, string>;
  person?: Person;
}

export async function prepare(req: BriefRequest): Promise<{ brief: Brief; snapshot: Snapshot; absence: Absence }> {
  const today = todayIso();
  const absence = normaliseAbsence(req.start, req.end, today);
  const snapshot = await gatherSnapshot({ personId: req.personId, absence, today, cloudId: req.cloudId, person: req.person });
  const overrides = Object.fromEntries(
    Object.entries(req.overrides ?? {}).filter(([k, v]) => isIssueKey(k) && isAccountId(v)),
  );
  return { brief: buildBrief(snapshot, overrides), snapshot, absence };
}

/** What changed on someone's work since they left. Defaults to the last 14 days. */
export async function welcomeBack(person: Person, since: unknown): Promise<WelcomeBack> {
  const today = todayIso();
  const from = isIsoDay(since) && since <= today ? since : addDays(today, -14);
  const items = await gatherReturn(person.accountId, from);
  return buildWelcomeBack(items, person, from, today);
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

/** Ranks stand-ins for a single work item, from its assignee's context. */
export async function standInsForItem(
  issueKey: string,
  requesterId: string | undefined,
  cloudId: string | undefined,
): Promise<{ owner: Person; item: { key: string; summary: string; url: string }; candidates: Candidate[]; brief: Brief }> {
  const raw = await getIssueRaw(issueKey);
  const item = parseIssue(raw);
  if (!item) throw new Error(`Could not read ${issueKey}.`);
  const owner = parsePersonResponse(raw?.fields?.assignee) ?? (requesterId ? await getPerson(requesterId) : await getMyself());
  const { brief, snapshot } = await prepare({ personId: owner.accountId, cloudId, person: owner });
  if (!snapshot.workItems.some((w) => w.key === item.key)) {
    snapshot.workItems.push(item);
  }
  const target = snapshot.workItems.find((w) => w.key === item.key)!;
  const candidates = rankStandIns(
    target,
    { personId: owner.accountId, teammates: snapshot.teammates, peerWork: snapshot.peerWork, openLoad: snapshot.openLoad },
    {},
    5,
  );
  return { owner, item: { key: item.key, summary: item.summary, url: item.url }, candidates, brief };
}

export interface NotifyRequest {
  issueKey: string;
  standIn: Person;
  requesterId?: string;
  cloudId?: string;
  start?: unknown;
  end?: unknown;
  note?: string;
}

/** Comments on the item to brief the stand-in, and adds them as a watcher. */
export async function notifyStandIn(r: NotifyRequest): Promise<{ commentId?: string; watching: boolean; message: string }> {
  if (!isIssueKey(r.issueKey)) throw new Error(`${r.issueKey} is not a Jira work item key.`);
  const raw = await getIssueRaw(r.issueKey);
  const item = parseIssue(raw);
  if (!item) throw new Error(`Could not read ${r.issueKey}.`);
  const owner = parsePersonResponse(raw?.fields?.assignee) ?? (r.requesterId ? await getPerson(r.requesterId) : await getMyself());
  if (owner.accountId === r.standIn.accountId) throw new Error(`${r.standIn.displayName} already owns ${item.key}.`);

  const { brief, absence } = await prepare({ personId: owner.accountId, start: r.start, end: r.end, cloudId: r.cloudId, person: owner });
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
