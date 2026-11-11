import { describe, expect, it } from 'vitest';
import {
  countByAssignee,
  isAccountId,
  isIssueKey,
  parseConfluenceSearch,
  parseGoalsAndProjects,
  parseIssue,
  parsePeerWork,
  parsePullRequests,
  parseTeamMembers,
  parseTeams,
  quoteIds,
} from '../src/adapters/parse';

// Shapes follow Jira's /rest/api/3/search/jql, Confluence's /wiki/rest/api/search
// and the Teamwork Graph curated queries. Values are synthetic.
const jiraIssue = {
  id: '10001',
  key: 'PAY-101',
  self: 'https://example.atlassian.net/rest/api/3/issue/10001',
  fields: {
    summary: 'Fix refund rounding for EUR',
    status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    priority: { name: 'High' },
    duedate: '2026-12-03',
    updated: '2026-11-20T10:00:00.000+0000',
    issuetype: { name: 'Story' },
    project: { key: 'PAY' },
    parent: { key: 'PAY-100', fields: { summary: 'Refunds v2' } },
    labels: ['refunds'],
    components: [{ name: 'Payments' }],
    reporter: { accountId: '712020:ben', displayName: 'Ben Okafor' },
    comment: {
      comments: [
        { author: { accountId: '712020:ben', displayName: 'Ben Okafor' }, created: '2026-11-24T09:00:00.000+0000' },
        { author: { accountId: '712020:ana', displayName: 'Ana Ruiz' }, created: '2026-11-21T09:00:00.000+0000' },
      ],
    },
    issuelinks: [
      { type: { inward: 'is blocked by' }, inwardIssue: { key: 'OPS-1', fields: { status: { statusCategory: { key: 'new' } } } } },
    ],
  },
};

describe('Jira parsing', () => {
  it('turns a search result into a work item', () => {
    const w = parseIssue(jiraIssue)!;
    expect(w).toMatchObject({
      key: 'PAY-101',
      url: 'https://example.atlassian.net/browse/PAY-101',
      statusCategory: 'indeterminate',
      priority: 'High',
      dueDate: '2026-12-03',
      projectKey: 'PAY',
      parentKey: 'PAY-100',
      parentSummary: 'Refunds v2',
      components: ['Payments'],
      blocked: true,
      blockedBy: ['OPS-1'],
    });
    expect(w.comments.map((c) => c.displayName)).toEqual(['Ana Ruiz', 'Ben Okafor']); // sorted oldest first
  });

  it('never counts apps, customers or deactivated accounts as people who could cover', () => {
    const noisy = structuredClone(jiraIssue) as typeof jiraIssue & { fields: { reporter: Record<string, unknown> } };
    noisy.fields.reporter = { accountId: 'portal:1', displayName: 'Customer', accountType: 'customer' };
    noisy.fields.comment.comments.push(
      { author: { accountId: '557058:auto', displayName: 'Automation for Jira', accountType: 'app' } as never, created: '2026-11-25T09:00:00.000+0000' },
      { author: { accountId: '712020:gone', displayName: 'Former user', active: false } as never, created: '2026-11-26T09:00:00.000+0000' },
    );
    const w = parseIssue(noisy)!;
    expect(w.reporter).toBeUndefined();
    expect(w.comments.map((c) => c.displayName)).toEqual(['Ana Ruiz', 'Ben Okafor']);
  });

  it('does not count its own briefings as the sender knowing the work', () => {
    const briefed = structuredClone(jiraIssue);
    briefed.fields.comment.comments.push({
      author: { accountId: '712020:ana', displayName: 'Ana Ruiz' },
      created: '2026-11-27T09:00:00.000+0000',
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sent with Understudy.' }] }] },
    } as never);
    expect(parseIssue(briefed)!.comments).toHaveLength(2);
  });

  it('ignores blockers that are already done', () => {
    const done = structuredClone(jiraIssue);
    done.fields.issuelinks[0]!.inwardIssue.fields.status.statusCategory.key = 'done';
    expect(parseIssue(done)!.blocked).toBe(false);
  });

  it('rejects malformed issues instead of guessing', () => {
    expect(parseIssue({})).toBeUndefined();
    expect(parseIssue({ key: 'X-1' })).toBeUndefined();
  });

  it('reads peer work and counts load per assignee', () => {
    const raw = { key: 'PAY-103', fields: { assignee: { accountId: '712020:ben', displayName: 'Ben Okafor' }, project: { key: 'PAY' }, parent: { key: 'PAY-100' }, labels: [], components: [{ name: 'Payments' }], updated: 'x' } };
    expect(parsePeerWork(raw)).toMatchObject({ accountId: '712020:ben', parentKey: 'PAY-100', components: ['Payments'] });
    expect(parsePeerWork({ key: 'PAY-9', fields: {} })).toBeUndefined();
    expect(countByAssignee([raw, raw, { fields: { assignee: { accountId: '712020:chen' } } }, { fields: {} }])).toEqual({ '712020:ben': 2, '712020:chen': 1 });
  });
});

describe('Confluence parsing', () => {
  it('builds absolute page links from the search base URL', () => {
    const pages = parseConfluenceSearch({
      _links: { base: 'https://example.atlassian.net/wiki' },
      results: [
        { content: { id: '42', title: 'Refunds v2 design', _links: { webui: '/spaces/PAY/pages/42' } }, resultGlobalContainer: { title: 'Payments' }, lastModified: '2026-11-01' },
        { content: {} },
      ],
    });
    expect(pages).toEqual([
      { id: '42', title: 'Refunds v2 design', url: 'https://example.atlassian.net/wiki/spaces/PAY/pages/42', lastModified: '2026-11-01', space: 'Payments' },
    ]);
  });
});

describe('Teamwork Graph parsing', () => {
  it('reads pull requests and keeps unknown statuses honest', () => {
    const prs = parsePullRequests(
      {
        edges: [
          { node: { __typename: 'ExternalPullRequest', id: 'ari:pr/1', title: 'Round half-even', url: 'https://git.example/1', status: 'OPEN' } },
          { node: { __typename: 'ExternalPullRequest', id: 'ari:pr/2', title: 'Odd', status: 'SOMETHING_NEW' } },
          { node: { __typename: 'ExternalBranch', id: 'ari:branch/1' } },
        ],
      },
      'PAY-101',
    );
    expect(prs.map((p) => [p.title, p.status, p.workItemKey])).toEqual([
      ['Round half-even', 'OPEN', 'PAY-101'],
      ['Odd', 'UNKNOWN', 'PAY-101'],
    ]);
  });

  it('keeps live goals and projects, drops archived and finished ones', () => {
    const goals = parseGoalsAndProjects({
      edges: [
        { node: { __typename: 'AtlassianGoal', id: 'g1', name: 'Refunds under 24h', url: 'u', dueDateEndedAt: '2026-12-31T00:00:00Z' } },
        { node: { __typename: 'AtlassianGoal', id: 'g2', name: 'Old', archived: true } },
        { node: { __typename: 'AtlassianProject', id: 'p1', name: 'Ledger', state: 'AT_RISK' } },
        { node: { __typename: 'AtlassianProject', id: 'p2', name: 'Shipped', state: 'DONE' } },
        { node: { __typename: 'AtlassianGoal', id: 'g1', name: 'Refunds under 24h' } },
      ],
    });
    expect(goals.map((g) => [g.kind, g.name, g.state ?? null, g.due ?? null])).toEqual([
      ['goal', 'Refunds under 24h', null, '2026-12-31'],
      ['project', 'Ledger', 'AT_RISK', null],
    ]);
  });

  it('reads teams and members', () => {
    expect(parseTeams({ edges: [{ node: { id: 'ari:team/1', displayName: 'Payments squad' } }, { node: {} }] })).toEqual([{ id: 'ari:team/1', name: 'Payments squad' }]);
    expect(parseTeamMembers({ edges: [{ node: { accountId: '712020:ben', name: 'Ben Okafor' } }, { node: { name: 'No id' } }] })).toEqual([
      { accountId: '712020:ben', displayName: 'Ben Okafor' },
    ]);
    expect(parseTeams(null)).toEqual([]);
  });
});

describe('input hygiene for JQL', () => {
  it('only lets real account IDs and issue keys through', () => {
    expect(isAccountId('712020:5fb4febc-facf-d600-76a1-c699')).toBe(true);
    expect(isAccountId('x" OR project = SECRET')).toBe(false);
    expect(isIssueKey('pay-101')).toBe(true);
    expect(isIssueKey('PAY-101; DROP')).toBe(false);
    expect(quoteIds(['712020:ben', 'bad id"', '5b10ac8d82e05b22cc7d4ef5'])).toBe('"712020:ben", "5b10ac8d82e05b22cc7d4ef5"');
  });
});
