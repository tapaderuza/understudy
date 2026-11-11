// Thin wrappers over Jira and Confluence REST APIs. Every call runs as the
// user who asked (asUser), so Understudy never shows anyone work they could
// not already open themselves.
//
// Each request is written out as api.asUser().requestX(route`...`) at its
// call site on purpose: that is the form `forge lint` can read to check the
// manifest grants the scope every endpoint needs.
import api, { route, type APIResponse } from '@forge/api';
import type { Page, Person } from '../core/types';
import { isAccountId, isIssueKey, parseConfluenceSearch, parsePersonResponse } from './parse';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export class ApiError extends Error {
  constructor(
    readonly product: 'jira' | 'confluence',
    readonly status: number,
    detail: string,
  ) {
    super(`${product} answered ${status}: ${detail.slice(0, 300)}`);
  }
}

const GET = { headers: { Accept: 'application/json' } };
const post = (body: unknown) => ({
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function json(product: 'jira' | 'confluence', res: APIResponse): Promise<Json> {
  if (!res.ok) throw new ApiError(product, res.status, await res.text());
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

export async function getMyself(): Promise<Person> {
  const p = parsePersonResponse(await json('jira', await api.asUser().requestJira(route`/rest/api/3/myself`, GET)));
  if (!p) throw new Error('Could not read the current user.');
  return p;
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
    );
  let res: Json;
  try {
    res = await attempt(title);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 400 || !/title/i.test(e.message)) throw e;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    res = await attempt(`${title} (updated ${stamp} UTC)`);
  }
  const base = res?._links?.base ?? '';
  return { id: String(res?.id), url: `${base}${res?._links?.webui ?? ''}` };
}
