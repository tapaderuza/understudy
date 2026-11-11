import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake @forge/api: each test answers Jira, Confluence and Teamwork Graph
// requests itself, in the shapes the real APIs use. Values are synthetic.
const forge = vi.hoisted(() => {
  const unexpected = (what: string) => () => {
    throw new Error(`unexpected ${what} call`);
  };
  return {
    jira: unexpected('Jira') as (path: string, init?: { method?: string; body?: string }) => unknown,
    confluence: unexpected('Confluence') as (path: string, init?: { method?: string; body?: string }) => unknown,
    graph: unexpected('Teamwork Graph') as (op: string) => unknown,
    calls: [] as string[],
  };
});

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({
      requestJira: async (path: string, init?: { method?: string; body?: string }) => {
        forge.calls.push(`jira ${init?.method ?? 'GET'} ${path}`);
        return forge.jira(path, init);
      },
      requestConfluence: async (path: string, init?: { method?: string; body?: string }) => {
        forge.calls.push(`confluence ${init?.method ?? 'GET'} ${path}`);
        return forge.confluence(path, init);
      },
      requestTeamworkGraph: async (_query: string, _variables: unknown, op: string) => {
        forge.calls.push(`graph ${op}`);
        return forge.graph(op);
      },
    }),
  },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''), ''),
}));

import { ApiError, createPage, getIssueRaw } from '../src/adapters/atlassian';
import { MAX_RETURN_ITEMS, confluenceNote, gatherReturn, gatherSnapshot } from '../src/adapters/gather';
import { parseIssue } from '../src/adapters/parse';
import { getHandoverBrief, suggestStandIns } from '../src/actions';
import { todayIn, toIsoDay } from '../src/core/dates';
import { UNEXPECTED } from '../src/core/errors';
import { rankStandIns } from '../src/core/standins';
import { handler } from '../src/resolvers';
import { NO_ASSIGNEE, notifyStandIn, requesterToday, resolvePerson, standInsForItem, welcomeBack } from '../src/service';

const ANA = { accountId: '712020:ana', displayName: 'Ana Ruiz' };
const BEN = { accountId: '712020:ben', displayName: 'Ben Okafor' };
const CHEN = { accountId: '712020:chen', displayName: 'Chen Wei' };
const SELF = 'https://example.atlassian.net/rest/api/3/issue/10001';

const reply = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers(headers),
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const jqlOf = (init?: { body?: string }) => String(JSON.parse(init?.body ?? '{}').jql ?? '');

function payIssue(assignee: unknown) {
  return {
    id: '10001',
    key: 'PAY-1',
    self: SELF,
    fields: {
      summary: 'Fix refund rounding',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High' },
      project: { key: 'PAY' },
      labels: [],
      components: [{ name: 'Payments' }],
      reporter: CHEN,
      assignee,
      comment: { comments: [{ author: BEN, created: '2026-11-01T09:00:00.000+0000' }] },
      issuelinks: [],
    },
  };
}

const peerIssue = (key: string, who: typeof BEN) => ({
  key,
  fields: { assignee: who, project: { key: 'PAY' }, labels: [], components: [{ name: 'Payments' }], updated: '2026-11-05T10:00:00.000+0000' },
});

/** A Jira site where Ana owns PAY-1 and Ben and Chen work nearby. */
function jiraSite(count: (jql: string) => unknown = () => reply(200, { count: 2 })) {
  return (path: string, init?: { method?: string; body?: string }) => {
    if (path.startsWith('/rest/api/3/myself')) return reply(200, { ...ANA, timeZone: 'Europe/Madrid' });
    if (path.startsWith('/rest/api/3/issue/PAY-1')) return reply(200, payIssue(ANA));
    if (path.startsWith('/rest/api/3/search/approximate-count')) return count(jqlOf(init));
    if (path.startsWith('/rest/api/3/search/jql')) {
      const jql = jqlOf(init);
      if (jql.startsWith(`assignee = "${ANA.accountId}"`)) return reply(200, { issues: [payIssue(ANA)], isLast: true });
      if (jql.startsWith('project in')) return reply(200, { issues: [peerIssue('PAY-2', BEN), peerIssue('PAY-3', CHEN)], isLast: true });
    }
    throw new Error(`unexpected Jira request ${path} ${jqlOf(init)}`);
  };
}

beforeEach(() => {
  forge.calls.length = 0;
  forge.graph = () => reply(200, { data: {} });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ApiError', () => {
  it('shows plain words and keeps the raw answer for the logs only', async () => {
    const raw = { errorMessages: ['You do not have the permission to see the specified issue.'] };
    forge.jira = () => reply(403, raw);
    const e = await getIssueRaw('PAY-1').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).message).toBe("You don't have permission to do this in Jira.");
    expect((e as ApiError).detail).toContain('permission to see the specified issue');
    expect(console.warn).toHaveBeenCalledWith('[understudy] jira answered 403', JSON.stringify(raw));
  });

  it('retries a taken page title once, then says plainly that it exists', async () => {
    forge.confluence = () => reply(409, { errors: [{ title: 'A page with this title already exists' }] });
    await expect(createPage('123', 'Handover', '<p/>')).rejects.toThrow('A page with this title already exists.');
    expect(forge.calls.filter((c) => c.includes('/wiki/api/v2/pages'))).toHaveLength(2);
  });
});

describe('gatherReturn', () => {
  it("retries without the watcher clause when Jira refuses it, and says the cap was reached", async () => {
    const jqls: string[] = [];
    forge.jira = (_path, init) => {
      const jql = jqlOf(init);
      jqls.push(jql);
      if (jql.includes('watcher')) return reply(400, { errorMessages: ["The value '712020:ben' does not exist for the field 'watcher'."] });
      const issues = Array.from({ length: MAX_RETURN_ITEMS }, (_, i) => ({ ...payIssue(BEN), key: `PAY-${i + 1}`, changelog: { histories: [] } }));
      return reply(200, { issues, isLast: false, nextPageToken: 'more' });
    };
    const r = await gatherReturn(BEN.accountId, '2026-11-01');
    expect(jqls).toHaveLength(2);
    expect(jqls[1]).not.toContain('watcher');
    expect(r.items).toHaveLength(MAX_RETURN_ITEMS);
    expect(r.notes).toEqual([
      'Watched work items were skipped because Jira did not allow searching them. Items they own or reported are included.',
      'Showing the 50 most recent changes.',
    ]);
  });

  it('does not retry other failures, and reports them in plain words', async () => {
    forge.jira = () => reply(503, '<html>upstream</html>');
    await expect(gatherReturn(BEN.accountId, '2026-11-01')).rejects.toThrow('Jira had a temporary problem. Try again.');
    expect(forge.calls).toHaveLength(1);
  });
});

describe('gatherSnapshot', () => {
  const absence = { start: '2026-11-20', end: '2026-11-27' };

  it('retries a rate-limited load count once and leaves out only a count that keeps failing', async () => {
    const tries: Record<string, number> = {};
    forge.jira = jiraSite((jql) => {
      const who = jql.includes(BEN.accountId) ? 'ben' : 'chen';
      tries[who] = (tries[who] ?? 0) + 1;
      if (who === 'chen') return reply(500, 'oops');
      return tries.ben === 1 ? reply(429, 'slow down', { 'Retry-After': '0' }) : reply(200, { count: 4 });
    });
    const s = await gatherSnapshot({ personId: ANA.accountId, person: ANA, absence, today: '2026-11-11', focus: parseIssue(payIssue(ANA)) });
    expect(tries).toEqual({ ben: 2, chen: 1 });
    expect(s.openLoad).toEqual({ [BEN.accountId]: 4 });
    expect(s.sources.notes).toContain('Could not read how much 1 of 2 possible stand-ins already carry, so their open items are not counted.');
  });

  it('tells "Confluence is not connected" apart from "Confluence could not be read"', async () => {
    expect(confluenceNote({ state: 'error', error: new ApiError('confluence', 404, '') })).toMatch(/^Confluence is not connected\./);
    expect(confluenceNote({ state: 'error', error: Object.assign(new Error('x'), { name: 'REQUEST_EGRESS_ALLOWLIST_ERR' }) })).toMatch(
      /^Confluence is not connected\./,
    );
    expect(confluenceNote({ state: 'error', error: new ApiError('confluence', 503, '') })).toBe(
      'Confluence could not be read (status 503), so pages are left out.',
    );
    forge.jira = jiraSite();
    forge.confluence = () => reply(500, 'boom');
    const s = await gatherSnapshot({ personId: ANA.accountId, person: ANA, absence, today: '2026-11-11' });
    expect(s.sources.confluence).toBe('unavailable');
    expect(s.sources.notes).toContain('Confluence could not be read (status 500), so pages are left out.');
  });

  it('still returns stand-ins when Teamwork Graph never answers', async () => {
    forge.jira = jiraSite();
    forge.graph = () => new Promise(() => undefined);
    const focus = parseIssue(payIssue(ANA))!;
    const s = await gatherSnapshot({ personId: ANA.accountId, person: ANA, absence, today: '2026-11-11', cloudId: 'c1', focus, budgetMs: 100 });
    expect(s.sources.teamworkGraph).toBe('unavailable');
    expect(s.sources.notes).toContain('Teamwork Graph took too long to answer, so teams, goals and pull requests are left out.');
    expect(forge.calls.some((c) => c.startsWith('confluence'))).toBe(false); // one work item needs no pages
    const ctx = { personId: ANA.accountId, teammates: s.teammates, peerWork: s.peerWork, openLoad: s.openLoad };
    expect(rankStandIns(focus, ctx).map((c) => c.accountId)).toEqual([BEN.accountId, CHEN.accountId]);
  });
});

describe('the issue panel', () => {
  const panel = (key: string) =>
    (handler as unknown as (req: unknown, runtime: unknown) => Promise<Record<string, unknown>>)(
      { call: { functionKey: 'issueStandIns', payload: {} }, context: { extension: { issue: { key } }, cloudId: 'c1' } },
      { principal: { accountId: ANA.accountId } },
    );

  it('answers within the time budget with candidates and evidence points, even if Teamwork Graph hangs', async () => {
    vi.useFakeTimers();
    forge.jira = jiraSite();
    forge.graph = () => new Promise(() => undefined);
    const pending = panel('PAY-1');
    await vi.advanceTimersByTimeAsync(19_000);
    const r = await pending;
    expect(r.unassigned).toBe(false);
    expect(r.notice).toBeNull();
    const candidates = r.candidates as { accountId: string; contextPoints: number; reasons: { points: number }[] }[];
    expect(candidates.map((c) => c.accountId)).toEqual([BEN.accountId, CHEN.accountId]);
    for (const c of candidates) {
      expect(c.contextPoints).toBe(c.reasons.filter((x) => x.points > 0).reduce((a, x) => a + x.points, 0));
    }
    expect(r.notes).toContain('Teamwork Graph took too long to answer, so teams, goals and pull requests are left out.');
  });

  it('says the work item has no assignee instead of guessing an owner', async () => {
    forge.jira = (path) => (path.startsWith('/rest/api/3/myself') ? reply(200, ANA) : reply(200, payIssue(null)));
    const r = await panel('PAY-1');
    expect(r).toMatchObject({ unassigned: true, notice: NO_ASSIGNEE, candidates: [], item: { key: 'PAY-1' } });
    expect(forge.calls.some((c) => c.includes('/search/'))).toBe(false);
  });

  it('shows a plain message when the work item cannot be read', async () => {
    forge.jira = (path) => (path.startsWith('/rest/api/3/myself') ? reply(200, ANA) : reply(404, { errorMessages: ['Issue does not exist'] }));
    expect(await panel('PAY-404')).toEqual({ error: "Not found, or you don't have access to it." });
  });
});

describe('service', () => {
  it('asks for an email address or account ID when several people match, naming up to five', async () => {
    const people = Array.from({ length: 7 }, (_, i) => ({ accountId: `712020:alex${i}`, displayName: `Alex ${i + 1}`, accountType: 'atlassian' }));
    forge.jira = () => reply(200, people);
    await expect(resolvePerson('Alex', ANA.accountId)).rejects.toThrow(
      '"Alex" matches several people: Alex 1, Alex 2, Alex 3, Alex 4, Alex 5 and 2 more. Give their email address or account ID to pick one.',
    );
    forge.jira = () => reply(200, [{ ...people[0], displayName: 'Alex Kim' }, { ...people[1], displayName: 'Alex Kim' }]);
    await expect(resolvePerson('Alex Kim', ANA.accountId)).rejects.toThrow('Alex Kim (account ID 712020:alex0), Alex Kim (account ID 712020:alex1)');
  });

  it("uses the requester's Jira time zone for today, and UTC when Jira does not answer", async () => {
    forge.jira = () => reply(200, { ...ANA, timeZone: 'Pacific/Kiritimati' });
    expect(await requesterToday()).toBe(todayIn('Pacific/Kiritimati'));
    forge.jira = () => reply(500, 'down');
    expect(await requesterToday()).toBe(toIsoDay(new Date()));
  });

  it('never briefs a stand-in on a work item without an assignee', async () => {
    forge.jira = (path) => (path.startsWith('/rest/api/3/myself') ? reply(200, ANA) : reply(200, payIssue(null)));
    await expect(notifyStandIn({ issueKey: 'PAY-1', standIn: BEN })).rejects.toThrow('PAY-1 has no assignee');
    expect(forge.calls.some((c) => c.includes('/comment'))).toBe(false);
    const r = await standInsForItem('PAY-1', undefined);
    expect(r).toMatchObject({ unassigned: true, message: NO_ASSIGNEE });
  });

  it('rejects wrong or future dates before any slow work', async () => {
    forge.jira = jiraSite();
    await expect(notifyStandIn({ issueKey: 'PAY-1', standIn: BEN, start: 'next week' })).rejects.toThrow(
      "Use dates as YYYY-MM-DD (got 'next week').",
    );
    await expect(notifyStandIn({ issueKey: 'PAY-1', standIn: BEN, start: '2026-12-10', end: '2026-12-01' })).rejects.toThrow(
      'The last day away (2026-12-01) is before the first day away (2026-12-10).',
    );
    expect(forge.calls).toEqual([]);
    await expect(welcomeBack(BEN, '2999-01-01')).rejects.toThrow('The first day away (2999-01-01) is in the future.');
    expect(forge.calls.some((c) => c.includes('/search/'))).toBe(false);
  });

  it('carries welcome-back notes through to the result', async () => {
    forge.jira = (_path, init) =>
      jqlOf(init).includes('watcher') ? reply(403, 'nope') : reply(200, { issues: [{ ...payIssue(BEN), changelog: { histories: [] } }], isLast: true });
    const w = await welcomeBack(BEN, '2026-11-01', '2026-11-11');
    expect(w.notes).toEqual(['Watched work items were skipped because Jira did not allow searching them. Items they own or reported are included.']);
  });
});

describe('Rovo actions', () => {
  it('answer a wrong date with a clear error and no Jira calls', async () => {
    expect(await getHandoverBrief({ person: 'me', startDate: 'next monday' }, { principal: { accountId: ANA.accountId } })).toEqual({
      error: "Use dates as YYYY-MM-DD (got 'next monday').",
    });
    expect(forge.calls).toEqual([]);
  });

  it('never pass on raw API answers or crashes', async () => {
    forge.jira = (path) => (path.startsWith('/rest/api/3/myself') ? reply(200, ANA) : reply(404, { errorMessages: ['Issue does not exist'] }));
    expect(await suggestStandIns({ issueKey: 'PAY-404' }, {})).toEqual({ error: "Not found, or you don't have access to it." });
    forge.jira = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'fields')");
    };
    expect(await suggestStandIns({ issueKey: 'PAY-1' }, {})).toEqual({ error: UNEXPECTED });
    expect(console.error).toHaveBeenCalled();
  });

  it('report a work item without an assignee instead of using the requester', async () => {
    forge.jira = (path) => (path.startsWith('/rest/api/3/myself') ? reply(200, ANA) : reply(200, payIssue(null)));
    expect(await suggestStandIns({ issueKey: 'PAY-1' }, { principal: { accountId: ANA.accountId } })).toMatchObject({
      owner: null,
      candidates: [],
      note: NO_ASSIGNEE,
    });
  });
});
