import type { PeerWork, Snapshot, WorkItem } from '../src/core/types';

// A small, synthetic team. Ana is going away; Ben, Chen and Dee could cover.
export const ANA = { accountId: 'acc-ana', displayName: 'Ana Ruiz' };
export const BEN = { accountId: 'acc-ben', displayName: 'Ben Okafor' };
export const CHEN = { accountId: 'acc-chen', displayName: 'Chen Wei' };
export const DEE = { accountId: 'acc-dee', displayName: 'Dee Patel' };

const SITE = 'https://example.atlassian.net';

export function item(partial: Partial<WorkItem> & Pick<WorkItem, 'key' | 'summary'>): WorkItem {
  return {
    id: partial.key.replace(/\D/g, ''),
    url: `${SITE}/browse/${partial.key}`,
    status: 'To Do',
    statusCategory: 'new',
    updated: '2026-11-20T10:00:00.000Z',
    projectKey: partial.key.split('-')[0] ?? 'X',
    labels: [],
    components: [],
    comments: [],
    blocked: false,
    pullRequests: [],
    ...partial,
  };
}

function peer(who: { accountId: string; displayName: string }, issueKey: string, extra: Partial<PeerWork> = {}): PeerWork {
  return {
    ...who,
    issueKey,
    projectKey: issueKey.split('-')[0] ?? 'X',
    labels: [],
    components: [],
    updated: '2026-11-15T10:00:00.000Z',
    ...extra,
  };
}

export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    person: ANA,
    absence: { start: '2026-12-01', end: '2026-12-05' },
    today: '2026-11-25',
    siteUrl: SITE,
    workItems: [
      item({
        key: 'PAY-101',
        summary: 'Fix refund rounding for EUR',
        status: 'In Progress',
        statusCategory: 'indeterminate',
        priority: 'High',
        dueDate: '2026-12-03',
        parentKey: 'PAY-100',
        parentSummary: 'Refunds v2',
        components: ['Payments'],
        comments: [
          { ...BEN, at: '2026-11-20T09:00:00.000Z' },
          { ...ANA, at: '2026-11-21T09:00:00.000Z' },
          { ...BEN, at: '2026-11-24T09:00:00.000Z' },
        ],
        pullRequests: [{ id: 'pr-1', title: 'Round half-even for EUR refunds', status: 'OPEN', url: 'https://git.example/pr/1' }],
      }),
      item({
        key: 'PAY-102',
        summary: 'Write migration for ledger table',
        status: 'In Progress',
        statusCategory: 'indeterminate',
        priority: 'Medium',
        parentKey: 'PAY-100',
        parentSummary: 'Refunds v2',
      }),
      item({ key: 'OPS-7', summary: 'Rotate staging certificates', priority: 'Highest', dueDate: '2026-11-20', components: ['Infra'] }),
      item({ key: 'PAY-110', summary: 'Update README badges', priority: 'Low' }),
      item({ key: 'PAY-90', summary: 'Already shipped', status: 'Done', statusCategory: 'done' }),
    ],
    pullRequests: [],
    goals: [{ id: 'g1', name: 'Refunds under 24 hours', kind: 'goal', state: 'AT_RISK', url: 'https://home.example/g1' }],
    pages: [{ id: 'p1', title: 'Refunds v2 design', url: `${SITE}/wiki/p1`, space: 'Payments' }],
    teammates: [
      { ...BEN, teams: ['Payments squad'] },
      { ...CHEN, teams: ['Payments squad'] },
      { ...DEE, teams: ['Payments squad'] },
    ],
    peerWork: [
      peer(BEN, 'PAY-103', { parentKey: 'PAY-100', components: ['Payments'] }),
      peer(BEN, 'PAY-104', { parentKey: 'PAY-100' }),
      peer(CHEN, 'PAY-105', { parentKey: 'PAY-100' }),
      peer(DEE, 'OPS-3', { components: ['Infra'] }),
    ],
    openLoad: { [BEN.accountId]: 9, [CHEN.accountId]: 2, [DEE.accountId]: 3 },
    sources: { jira: 'ok', confluence: 'ok', teamworkGraph: 'ok', notes: [] },
    ...overrides,
  };
}
