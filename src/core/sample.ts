// A small fictional finance and operations team, so someone who installs
// Understudy on an empty site can see what a plan looks like. Pure: nothing
// here is read from or written to a site, and every name says "(sample)".
import { addDays } from './dates';
import type { OwnedItem, TeamSnapshot } from './team';
import type { Activity, PeerWork, Person, Snapshot, WorkItem } from './types';

const person = (id: string, name: string): Person => ({ accountId: `sample-${id}`, displayName: `${name} (sample)` });

export const SAMPLE = {
  nora: person('nora', 'Nora Lind'),
  sam: person('sam', 'Sam Okafor'),
  priya: person('priya', 'Priya Shah'),
  leo: person('leo', 'Leo Martin'),
};

export const SAMPLE_NOTE = 'Sample data: a fictional team, so you can see what Understudy shows. Nothing is read from or written to your site.';

export const isSampleId = (accountId: string | undefined): boolean => Boolean(accountId?.startsWith('sample-'));

const said = (p: Person, today: string, daysAgo: number): Activity => ({
  accountId: p.accountId,
  displayName: p.displayName,
  at: `${addDays(today, -daysAgo)}T10:00:00.000Z`,
});

function item(today: string, w: Partial<WorkItem> & Pick<WorkItem, 'key' | 'summary'>): WorkItem {
  return {
    id: w.key.replace(/\D/g, ''),
    url: '#sample',
    status: 'To Do',
    statusCategory: 'new',
    updated: `${today}T09:00:00.000Z`,
    projectKey: w.key.split('-')[0] ?? 'FIN',
    labels: [],
    components: [],
    comments: [],
    blocked: false,
    pullRequests: [],
    ...w,
  };
}

function peer(p: Person, issueKey: string, today: string, extra: Partial<PeerWork> = {}): PeerWork {
  return {
    accountId: p.accountId,
    displayName: p.displayName,
    issueKey,
    projectKey: issueKey.split('-')[0] ?? 'FIN',
    labels: [],
    components: [],
    updated: `${addDays(today, -5)}T10:00:00.000Z`,
    ...extra,
  };
}

/** Nora's open work, as a handover would read it. */
function noraItems(today: string, start: string, end: string): WorkItem[] {
  const { nora, sam, priya, leo } = SAMPLE;
  return [
    item(today, {
      key: 'FIN-12',
      summary: 'Month-end close checklist',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      priority: 'High',
      dueDate: addDays(start, 1),
      parentKey: 'FIN-10',
      parentSummary: 'Q4 close',
      components: ['Close'],
      reporter: sam,
      comments: [said(sam, today, 6), said(nora, today, 4), said(sam, today, 1)],
    }),
    item(today, {
      key: 'FIN-14',
      summary: 'Renew the card processor contract',
      priority: 'Highest',
      dueDate: addDays(today, -2),
      labels: ['vendors'],
      reporter: priya,
      comments: [said(priya, today, 3)],
    }),
    item(today, {
      key: 'TAX-4',
      summary: 'Quarter-end tax export',
      status: 'In Progress',
      statusCategory: 'indeterminate',
      dueDate: addDays(start, 2),
      components: ['Tax'],
    }),
    item(today, {
      key: 'OPS-7',
      summary: 'Switch the payroll export to the new bank format',
      status: 'Blocked',
      statusCategory: 'indeterminate',
      priority: 'High',
      blocked: true,
      blockedBy: ['OPS-6'],
      components: ['Payroll'],
      comments: [said(leo, today, 2)],
    }),
    item(today, {
      key: 'HR-3',
      summary: 'Onboarding plan for two new hires',
      priority: 'Medium',
      dueDate: end,
      labels: ['onboarding'],
    }),
    item(today, { key: 'FIN-18', summary: 'Archive closed invoices', priority: 'Low' }),
    item(today, { key: 'OPS-9', summary: 'Update the expense policy page', priority: 'Low' }),
  ];
}

function peerWork(today: string): PeerWork[] {
  const { sam, priya, leo } = SAMPLE;
  return [
    peer(sam, 'FIN-11', today, { parentKey: 'FIN-10', components: ['Close'] }),
    peer(sam, 'FIN-13', today, { parentKey: 'FIN-10', components: ['Close'] }),
    peer(priya, 'FIN-16', today, { labels: ['vendors'] }),
    peer(priya, 'HR-1', today, { labels: ['onboarding'] }),
    peer(priya, 'HR-2', today, { labels: ['onboarding'] }),
    peer(leo, 'OPS-5', today, { components: ['Payroll'] }),
    peer(leo, 'OPS-6', today, { components: ['Payroll'] }),
  ];
}

const LOAD: Record<string, number> = { [SAMPLE.sam.accountId]: 4, [SAMPLE.priya.accountId]: 7, [SAMPLE.leo.accountId]: 3 };

/** Nora is away for the next working week. */
export function sampleSnapshot(today: string): Snapshot {
  const start = addDays(today, 1);
  const end = addDays(today, 5);
  const { sam, priya, leo } = SAMPLE;
  return {
    person: SAMPLE.nora,
    absence: { start, end },
    today,
    workItems: noraItems(today, start, end),
    pullRequests: [],
    goals: [{ id: 'sample-goal', name: 'Close the Q4 books in 5 working days', kind: 'goal', state: 'ON_TRACK' }],
    pages: [],
    teammates: [sam, priya, leo].map((p) => ({ accountId: p.accountId, displayName: p.displayName, teams: ['Finance ops (sample)'] })),
    peerWork: peerWork(today),
    openLoad: LOAD,
    sources: { jira: 'ok', confluence: 'empty', teamworkGraph: 'ok', notes: [SAMPLE_NOTE] },
  };
}

/** The same team as a manager would see it in Team risk. */
export function sampleTeamSnapshot(today: string): TeamSnapshot {
  const { nora, sam, priya, leo } = SAMPLE;
  const owned: OwnedItem[] = noraItems(today, addDays(today, 1), addDays(today, 5)).map((w) => ({ item: w, owner: nora }));
  owned.push(
    {
      owner: sam,
      item: item(today, {
        key: 'FIN-11',
        summary: 'Reconcile the bank accounts for October',
        status: 'In Progress',
        statusCategory: 'indeterminate',
        parentKey: 'FIN-10',
        components: ['Close'],
        comments: [said(nora, today, 2)],
      }),
    },
    { owner: sam, item: item(today, { key: 'FIN-13', summary: 'Accruals for the Q4 close', parentKey: 'FIN-10', components: ['Close'] }) },
    {
      owner: priya,
      item: item(today, { key: 'HR-2', summary: 'Laptop and access requests for new hires', labels: ['onboarding'], dueDate: addDays(today, 3), priority: 'High' }),
    },
    {
      owner: priya,
      item: item(today, { key: 'FIN-16', summary: 'Vendor risk review for the new courier', labels: ['vendors'], comments: [said(nora, today, 3)] }),
    },
    {
      owner: leo,
      item: item(today, {
        key: 'OPS-6',
        summary: 'Get the new bank file specification signed off',
        priority: 'Highest',
        dueDate: addDays(today, 2),
        status: 'In Progress',
        statusCategory: 'indeterminate',
        components: ['Payroll'],
      }),
    },
    { owner: leo, item: item(today, { key: 'OPS-5', summary: 'Payroll cut-off calendar for next year', components: ['Payroll'] }) },
  );
  return {
    projects: ['FIN', 'OPS', 'HR', 'TAX'],
    today,
    items: owned,
    peerWork: peerWork(today),
    openLoad: { ...LOAD, [nora.accountId]: 7 },
    notes: [SAMPLE_NOTE],
  };
}
