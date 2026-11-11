// Pure parsers for Atlassian API responses. Kept apart from the HTTP calls so
// they can be tested against recorded response shapes.
import { addDays } from '../core/dates';
import type { ReturnEvent, ReturnItem } from '../core/handback';
import type { Activity, Goal, Page, PeerWork, Person, PullRequest, PullRequestStatus, StatusCategory, WorkItem } from '../core/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

export function siteFromSelf(self: unknown): string | undefined {
  const s = str(self);
  if (!s) return undefined;
  try {
    return new URL(s).origin;
  } catch {
    return undefined;
  }
}

function statusCategory(fields: Json): StatusCategory {
  const key = fields?.status?.statusCategory?.key;
  return key === 'done' || key === 'indeterminate' ? key : 'new';
}

function person(p: Json): Person | undefined {
  const accountId = str(p?.accountId);
  if (!accountId) return undefined;
  return { accountId, displayName: str(p?.displayName) ?? 'Unknown user', avatarUrl: str(p?.avatarUrls?.['48x48']) };
}

/**
 * Only active people can cover work: not apps such as Automation for Jira,
 * not service desk customers, not deactivated accounts. Fields Jira leaves out
 * count as a person, so sparse test data still works.
 */
export function isActivePerson(p: Json): boolean {
  if (!str(p?.accountId)) return false;
  const type = p?.accountType;
  return (type === undefined || type === 'atlassian') && p?.active !== false;
}

/** Keys of unresolved items linked to this one as "is blocked by". */
function blockers(links: Json): string[] {
  if (!Array.isArray(links)) return [];
  return links
    .filter(
      (l: Json) =>
        /blocked by/i.test(String(l?.type?.inward ?? '')) &&
        l?.inwardIssue &&
        l.inwardIssue?.fields?.status?.statusCategory?.key !== 'done',
    )
    .map((l: Json) => str(l.inwardIssue?.key) ?? '?');
}

function comments(fields: Json): Activity[] {
  const list: Json[] = fields?.comment?.comments ?? [];
  return list
    // A briefing Understudy posted is not evidence that its sender knows the work.
    .filter((c) => isActivePerson(c?.author) && !adfText(c?.body).includes(UNDERSTUDY_SIGNATURE))
    .map((c) => ({ accountId: str(c?.author?.accountId), displayName: str(c?.author?.displayName) ?? 'Unknown user', at: str(c?.created) }))
    .filter((c): c is Activity => Boolean(c.accountId && c.at))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function parseIssue(raw: Json): WorkItem | undefined {
  const key = str(raw?.key);
  const f = raw?.fields;
  if (!key || !f) return undefined;
  const site = siteFromSelf(raw?.self);
  return {
    key,
    id: String(raw?.id ?? ''),
    summary: str(f.summary) ?? key,
    url: site ? `${site}/browse/${key}` : key,
    status: str(f.status?.name) ?? 'Unknown',
    statusCategory: statusCategory(f),
    priority: str(f.priority?.name),
    dueDate: str(f.duedate)?.slice(0, 10),
    updated: str(f.updated) ?? '',
    issueType: str(f.issuetype?.name),
    projectKey: str(f.project?.key) ?? key.split('-')[0] ?? '',
    parentKey: str(f.parent?.key),
    parentSummary: str(f.parent?.fields?.summary),
    labels: Array.isArray(f.labels) ? f.labels.filter((x: unknown) => typeof x === 'string') : [],
    components: Array.isArray(f.components) ? f.components.map((c: Json) => str(c?.name)).filter(Boolean) : [],
    reporter: isActivePerson(f.reporter) ? person(f.reporter) : undefined,
    comments: comments(f),
    blocked: blockers(f.issuelinks).length > 0,
    blockedBy: blockers(f.issuelinks),
    pullRequests: [],
  };
}

export function parsePeerWork(raw: Json): PeerWork | undefined {
  const f = raw?.fields;
  const who = isActivePerson(f?.assignee) ? person(f?.assignee) : undefined;
  const issueKey = str(raw?.key);
  if (!who || !issueKey) return undefined;
  return {
    accountId: who.accountId,
    displayName: who.displayName,
    issueKey,
    projectKey: str(f?.project?.key) ?? issueKey.split('-')[0] ?? '',
    parentKey: str(f?.parent?.key),
    labels: Array.isArray(f?.labels) ? f.labels : [],
    components: Array.isArray(f?.components) ? f.components.map((c: Json) => str(c?.name)).filter(Boolean) : [],
    updated: str(f?.updated) ?? '',
  };
}

/** Counts open items per assignee from a search over several people. */
export function countByAssignee(issues: Json[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of issues) {
    const id = str(i?.fields?.assignee?.accountId);
    if (id) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

export function parsePersonResponse(raw: Json): Person | undefined {
  return person(raw);
}

export function parseConfluenceSearch(raw: Json): Page[] {
  const base = str(raw?._links?.base) ?? '';
  const results: Json[] = Array.isArray(raw?.results) ? raw.results : [];
  return results
    .map((r): Page | undefined => {
      const id = str(r?.content?.id);
      const webui = str(r?.content?._links?.webui) ?? str(r?.url);
      if (!id || !webui) return undefined;
      return {
        id,
        title: str(r?.content?.title) ?? str(r?.title) ?? 'Untitled',
        url: webui.startsWith('http') ? webui : `${base}${webui}`,
        lastModified: str(r?.lastModified),
        space: str(r?.resultGlobalContainer?.title),
      };
    })
    .filter((p): p is Page => Boolean(p));
}

// ---- Teamwork Graph (Relay connections whose nodes are unions) ----

export function edgesOf(connection: Json): Json[] {
  const edges = connection?.edges;
  return Array.isArray(edges) ? edges.map((e: Json) => e?.node).filter(Boolean) : [];
}

const PR_STATUSES: PullRequestStatus[] = ['OPEN', 'DRAFT', 'MERGED', 'DECLINED', 'UNKNOWN'];

export function parsePullRequests(connection: Json, workItemKey?: string): PullRequest[] {
  return edgesOf(connection)
    .filter((n) => n.__typename === undefined || n.__typename === 'ExternalPullRequest')
    .map((n): PullRequest | undefined => {
      const status = PR_STATUSES.includes(n.status) ? (n.status as PullRequestStatus) : 'UNKNOWN';
      const id = str(n.id) ?? str(n.url);
      if (!id) return undefined;
      return {
        id,
        title: str(n.title) ?? str(n.displayId) ?? 'Pull request',
        url: str(n.url),
        status,
        displayId: str(n.displayId),
        updated: str(n.lastUpdatedAt),
        workItemKey,
      };
    })
    .filter((p): p is PullRequest => Boolean(p));
}

const CLOSED_PROJECT_STATES = new Set(['DONE', 'CANCELLED', 'ARCHIVED']);

export function parseGoalsAndProjects(connection: Json): Goal[] {
  const out: Goal[] = [];
  for (const n of edgesOf(connection)) {
    if (n.archived === true) continue;
    if (n.__typename === 'AtlassianGoal') {
      out.push({ id: n.id, name: str(n.name) ?? 'Goal', url: str(n.url), kind: 'goal', due: str(n.dueDateEndedAt)?.slice(0, 10) });
    } else if (n.__typename === 'AtlassianProject') {
      if (CLOSED_PROJECT_STATES.has(n.state)) continue;
      out.push({ id: n.id, name: str(n.name) ?? 'Project', url: str(n.url), kind: 'project', state: str(n.state), due: str(n.dueDateEndedAt)?.slice(0, 10) });
    }
  }
  const seen = new Set<string>();
  return out.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
}

export function parseTeams(connection: Json): { id: string; name: string }[] {
  return edgesOf(connection)
    .filter((n) => str(n.id))
    .map((n) => ({ id: n.id as string, name: str(n.displayName) ?? 'Team' }));
}

export function parseTeamMembers(connection: Json): Person[] {
  return edgesOf(connection)
    .map((n) => (str(n.accountId) ? { accountId: n.accountId as string, displayName: str(n.name) ?? 'Unknown user' } : undefined))
    .filter((p): p is Person => Boolean(p));
}

// ---- input hygiene for JQL and CQL ----

const ACCOUNT_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,49}$/;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,9}$/;

export const isAccountId = (v: unknown): v is string => typeof v === 'string' && ACCOUNT_ID.test(v);
export const isProjectKey = (v: unknown): v is string => typeof v === 'string' && PROJECT_KEY.test(v);
export const isIssueKey = (v: unknown): v is string => typeof v === 'string' && ISSUE_KEY.test(v.trim().toUpperCase());

export function quoteIds(ids: string[]): string {
  return ids.filter(isAccountId).map((id) => `"${id}"`).join(', ');
}

// ---- Atlassian Document Format (comment bodies) ----

/** Plain text of an ADF document, mentions written as their display text. */
export function adfText(node: Json): string {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return String(node.text ?? '');
  if (node.type === 'mention') return String(node.attrs?.text ?? '@someone');
  if (node.type === 'hardBreak') return ' ';
  const inner = Array.isArray(node.content) ? node.content.map(adfText).join(node.type === 'doc' ? ' ' : '') : '';
  return inner.replace(/\s+/g, ' ').trim();
}

/** Account IDs mentioned anywhere in an ADF document. */
export function adfMentions(node: Json, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'mention' && str(node.attrs?.id)) out.push(node.attrs.id);
  if (Array.isArray(node.content)) node.content.forEach((c: Json) => adfMentions(c, out));
  return out;
}

// ---- What happened to someone's work while they were away ----

const UNDERSTUDY_SIGNATURE = 'Sent with Understudy';

/** Briefings are usually sent in the days before someone leaves, so look this far back for one. */
const BRIEFING_LOOKBACK_DAYS = 14;

/**
 * Reads one work item (searched with expand=changelog) and keeps only what
 * other people did since `since`: status moves, reassignments and comments.
 */
export function parseReturnIssue(raw: Json, personId: string, since: string): ReturnItem | undefined {
  const base = parseIssue(raw);
  if (!base) return undefined;
  const events: ReturnEvent[] = [];
  let coveredBy: string | undefined;

  for (const h of raw?.changelog?.histories ?? []) {
    const at = str(h?.created);
    const by = str(h?.author?.displayName) ?? 'Someone';
    if (!at || at < since || h?.author?.accountId === personId) continue;
    for (const it of h?.items ?? []) {
      if (it?.field === 'status') {
        events.push({ at, by, kind: 'status', text: `${it.fromString ?? '?'} → ${it.toString ?? '?'}` });
      } else if (it?.field === 'assignee') {
        const to = it.to === personId ? 'you' : it.toString ?? 'unassigned';
        events.push({ at, by, kind: 'assignee', text: `${it.fromString ?? 'unassigned'} → ${to}`, toYou: it.to === personId });
      }
    }
  }

  let mentionsYou = false;
  const briefedFrom = addDays(since.slice(0, 10), -BRIEFING_LOOKBACK_DAYS);
  for (const c of raw?.fields?.comment?.comments ?? []) {
    const at = str(c?.created);
    if (!at) continue;
    const text = adfText(c?.body);
    // A briefing names the stand-in whoever sent it, most often the person
    // themselves just before leaving, so it is read before the author and
    // date checks below. It is never an event to catch up on. The latest wins.
    if (text.includes(UNDERSTUDY_SIGNATURE)) {
      if (at >= briefedFrom) coveredBy = str(c?.body?.content?.[0]?.content?.[0]?.attrs?.text)?.replace(/^@/, '') ?? coveredBy;
      continue;
    }
    if (at < since || c?.author?.accountId === personId) continue;
    const mentioned = adfMentions(c?.body).includes(personId);
    mentionsYou = mentionsYou || mentioned;
    events.push({ at, by: str(c?.author?.displayName) ?? 'Someone', kind: mentioned ? 'mention' : 'comment', text: text.slice(0, 160) });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return {
    key: base.key,
    summary: base.summary,
    url: base.url,
    status: base.status,
    statusCategory: base.statusCategory,
    assignedToYou: raw?.fields?.assignee?.accountId === personId,
    events,
    mentionsYou,
    coveredBy,
  };
}
