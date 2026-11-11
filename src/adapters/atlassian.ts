// Thin wrappers over Jira and Confluence REST APIs. Every call runs as the
// user who asked (asUser), so Understudy never shows anyone work they could
// not already open themselves.
//
// Each request is written out as api.asUser().requestX(route`...`) at its
// call site on purpose: that is the form `forge lint` can read to check the
// manifest grants the scope every endpoint needs.
import api, { route, type APIResponse } from '@forge/api';
import { apiErrorMessage, type ApiAction, type Product } from '../core/errors';
import type { Page, Person } from '../core/types';
import { isAccountId, isIssueKey, isProjectKey, parseConfluenceSearch, parsePersonResponse } from './parse';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/**
 * A Jira or Confluence error status. Its message is the plain one a person
 * can read (core/errors); Atlassian's own answer is kept in `detail` and only
 * ever written to the logs.
 */
export class ApiError extends Error {
  /** Atlassian's raw answer, for logs and checks only. Never shown to people. */
  readonly detail: string;
  /** How long Atlassian asked us to wait (Retry-After), when it said. */
  readonly retryAfterMs?: number;

  constructor(
    readonly product: Product,
    readonly status: number,
    detail: string,
    opts: { action?: ApiAction; retryAfterMs?: number } = {},
  ) {
    super(apiErrorMessage(product, status, opts.action));
    this.name = 'ApiError';
    this.detail = detail.slice(0, 300);
    this.retryAfterMs = opts.retryAfterMs;
  }
}

const GET = { headers: { Accept: 'application/json' } };
const post = (body: unknown) => ({
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function retryAfterMs(res: APIResponse): number | undefined {
  const raw = res.headers?.get?.('Retry-After');
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

async function json(product: Product, res: APIResponse, action?: ApiAction): Promise<Json> {
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // The raw answer goes to `forge logs` only; people see ApiError's plain message.
    console.warn(`[understudy] ${product} answered ${res.status}`, detail.slice(0, 300));
    throw new ApiError(product, res.status, detail, { action, retryAfterMs: retryAfterMs(res) });
  }
  return res.status === 204 ? null : res.json();
}

// ---- Jira ----

export const ISSUE_FIELDS = [
  'summary',
  'status',
  'priority',
  'duedate',
  'updated',
  'issuetype',
  'project',
  'parent',
  'labels',
  'components',
  'reporter',
  'comment',
  'issuelinks',
];

/** Enhanced JQL search, following nextPageToken up to `max` issues. */
export async function searchIssues(jql: string, fields: string[], max = 100, expand?: 'changelog'): Promise<Json[]> {
  const out: Json[] = [];
  let nextPageToken: string | undefined;
  do {
    const body: Json = { jql, fields, maxResults: Math.min(100, max - out.length) };
    if (expand) body.expand = expand;
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await json('jira', await api.asUser().requestJira(route`/rest/api/3/search/jql`, post(body)));
    out.push(...(page?.issues ?? []));
    nextPageToken = page?.isLast === false ? page?.nextPageToken : undefined;
  } while (nextPageToken && out.length < max);
  return out;
}

/** How many issues match, without reading them. Jira's count is approximate for very large results. */
export async function approximateCount(jql: string): Promise<number> {
  const res = await json('jira', await api.asUser().requestJira(route`/rest/api/3/search/approximate-count`, post({ jql })));
  const n = Number(res?.count);
  if (!Number.isFinite(n)) throw new Error('Jira did not return a count.');
  return n;
}

export interface ProjectRef {
  key: string;
  name: string;
}

/** Projects the user can browse, the ones with the most recent activity first. */
export async function listProjects(max = 50): Promise<ProjectRef[]> {
  const res = await json(
    'jira',
    await api.asUser().requestJira(route`/rest/api/3/project/search?maxResults=${max}&expand=insight`, GET),
  );
  const values: Json[] = Array.isArray(res?.values) ? res.values : [];
  return values
    .filter((p) => isProjectKey(p?.key) && p?.archived !== true)
    .sort((a, b) => String(b?.insight?.lastIssueUpdateTime ?? '').localeCompare(String(a?.insight?.lastIssueUpdateTime ?? '')))
    .map((p) => ({ key: String(p.key), name: String(p.name ?? p.key) }));
}

export async function getMyself(): Promise<Person> {
  const p = parsePersonResponse(await json('jira', await api.asUser().requestJira(route`/rest/api/3/myself`, GET)));
  if (!p) throw new Error('Could not read the current user.');
  return p;
}

/** The current user's time zone from their Jira profile, such as "Europe/Madrid", when Jira shares it. */
export async function getMyTimeZone(): Promise<string | undefined> {
  const me = await json('jira', await api.asUser().requestJira(route`/rest/api/3/myself`, GET));
  return typeof me?.timeZone === 'string' && me.timeZone ? me.timeZone : undefined;
}

export async function getPerson(accountId: string): Promise<Person> {
  if (!isAccountId(accountId)) throw new Error('That does not look like an Atlassian account ID.');
  const p = parsePersonResponse(
    await json('jira', await api.asUser().requestJira(route`/rest/api/3/user?accountId=${accountId}`, GET)),
  );
  if (!p) throw new Error(`No user found for ${accountId}.`);
  return p;
}

/** Finds active human users by name or email fragment. */
export async function findPeople(query: string, max = 5): Promise<Person[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const list: Json[] = await json(
    'jira',
    await api.asUser().requestJira(route`/rest/api/3/user/search?query=${q}&maxResults=${max}`, GET),
  );
  return (Array.isArray(list) ? list : [])
    .filter((u) => u?.accountType === 'atlassian' && u?.active !== false)
    .map(parsePersonResponse)
    .filter((p): p is Person => Boolean(p));
}

export async function getIssueRaw(key: string): Promise<Json> {
  if (!isIssueKey(key)) throw new Error(`${key} is not a Jira work item key.`);
  const k = key.trim().toUpperCase();
  const fields = [...ISSUE_FIELDS, 'assignee'].join(',');
  return json('jira', await api.asUser().requestJira(route`/rest/api/3/issue/${k}?fields=${fields}`, GET));
}

export async function addComment(key: string, adf: Json): Promise<string | undefined> {
  if (!isIssueKey(key)) throw new Error(`${key} is not a Jira work item key.`);
  const k = key.trim().toUpperCase();
  const res = await json('jira', await api.asUser().requestJira(route`/rest/api/3/issue/${k}/comment`, post({ body: adf })));
  return res?.id;
}

/** Replaces the body of a comment the current user wrote. */
export async function updateComment(key: string, commentId: string, adf: Json): Promise<string> {
  if (!isIssueKey(key)) throw new Error(`${key} is not a Jira work item key.`);
  if (!/^\d{1,20}$/.test(commentId)) throw new Error('That is not a Jira comment ID.');
  const k = key.trim().toUpperCase();
  const res = await json(
    'jira',
    await api.asUser().requestJira(route`/rest/api/3/issue/${k}/comment/${commentId}`, { ...post({ body: adf }), method: 'PUT' }),
  );
  return String(res?.id ?? commentId);
}

/** Best effort: watching keeps the stand-in informed, but is not essential. */
export async function addWatcher(key: string, accountId: string): Promise<boolean> {
  if (!isIssueKey(key) || !isAccountId(accountId)) return false;
  const k = key.trim().toUpperCase();
  try {
    await json('jira', await api.asUser().requestJira(route`/rest/api/3/issue/${k}/watchers`, post(accountId)));
    return true;
  } catch {
    return false;
  }
}

// ---- Confluence ----

export async function recentPagesBy(accountId: string, limit = 10): Promise<Page[]> {
  if (!isAccountId(accountId)) return [];
  const cql = `contributor = "${accountId}" AND type = page AND lastmodified >= now("-60d") ORDER BY lastmodified DESC`;
  return parseConfluenceSearch(
    await json('confluence', await api.asUser().requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=${limit}`, GET)),
  );
}

export interface Space {
  id: string;
  key: string;
  name: string;
}

const toSpace = (s: Json): Space => ({ id: String(s.id), key: String(s.key), name: String(s.name ?? s.key) });

export async function listSpaces(): Promise<Space[]> {
  const res = await json(
    'confluence',
    await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?limit=${100}&status=current&sort=name`, GET),
  );
  return (res?.results ?? []).filter((s: Json) => s?.id && s?.key).map(toSpace);
}

export async function spaceByKey(key: string): Promise<Space | undefined> {
  const clean = key.trim();
  if (!/^[A-Za-z0-9~_-]{1,255}$/.test(clean)) return undefined;
  const res = await json('confluence', await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?keys=${clean}`, GET));
  const s = res?.results?.[0];
  return s ? toSpace(s) : undefined;
}

/** Creates a page; if the title is taken in that space, adds the time to make it unique. */
export async function createPage(spaceId: string, title: string, storage: string): Promise<{ id: string; url: string }> {
  const attempt = async (t: string) =>
    json(
      'confluence',
      await api
        .asUser()
        .requestConfluence(
          route`/wiki/api/v2/pages`,
          post({ spaceId, status: 'current', title: t, body: { representation: 'storage', value: storage } }),
        ),
      'create-page',
    );
  let res: Json;
  try {
    res = await attempt(title);
  } catch (e) {
    const titleTaken = e instanceof ApiError && (e.status === 400 || e.status === 409) && /title/i.test(e.detail);
    if (!titleTaken) throw e;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    res = await attempt(`${title} (updated ${stamp} UTC)`);
  }
  const base = res?._links?.base ?? '';
  return { id: String(res?.id), url: `${base}${res?._links?.webui ?? ''}` };
}
