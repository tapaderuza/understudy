import { describe, expect, it } from 'vitest';
import { parseIssue, parseLeaveItem } from '../src/adapters/parse';
import { buildBrief } from '../src/core/brief';
import { draftHandoverComment } from '../src/core/render';
import { sampleSnapshot } from '../src/core/sample';
import { isRelevantEvent, leaveDates, shouldWithdraw } from '../src/proactive';

const ADA = { accountId: '712020:ada', displayName: 'Ada Isadora', accountType: 'atlassian' };
const HR = { accountId: '712020:hr', displayName: 'HR Desk', accountType: 'atlassian' };

const raw = (fields: Record<string, unknown>) => ({ key: 'PEOPLE-7', fields: { summary: 'Something', comment: { comments: [] }, ...fields } });

describe('time-off work items', () => {
  it('are recognised by type, label or summary, and nothing else', () => {
    expect(parseLeaveItem(raw({ issuetype: { name: 'Time off' }, reporter: ADA }))?.leaver.displayName).toBe('Ada Isadora');
    expect(parseLeaveItem(raw({ issuetype: { name: 'Task' }, labels: ['Vacation'], reporter: ADA }))?.key).toBe('PEOPLE-7');
    expect(parseLeaveItem(raw({ issuetype: { name: 'Task' }, summary: 'Time off: Ada, 12 to 14 Nov', reporter: ADA }))).toBeDefined();
    expect(parseLeaveItem(raw({ issuetype: { name: 'Task' }, summary: 'Leaver checklist for Ben', reporter: ADA }))).toBeUndefined();
    expect(parseLeaveItem(raw({ issuetype: { name: 'Bug' }, labels: ['refunds'], reporter: ADA }))).toBeUndefined();
  });

  it('are drafted for whoever filed them, never for an assignee such as an HR agent, an app or a customer', () => {
    expect(parseLeaveItem(raw({ labels: ['pto'], assignee: HR, reporter: ADA }))?.leaver.accountId).toBe('712020:ada');
    expect(parseLeaveItem(raw({ labels: ['pto'], assignee: ADA }))).toBeUndefined();
    expect(parseLeaveItem(raw({ labels: ['pto'], reporter: { accountId: 'qm:1', displayName: 'Customer', accountType: 'customer' } }))).toBeUndefined();
  });

  it('react to new items and to updates of fields that matter, nothing else', () => {
    expect(isRelevantEvent({ eventType: 'avi:jira:created:issue' })).toBe(true);
    expect(isRelevantEvent({ eventType: 'avi:jira:updated:issue', changelog: { items: [{ field: 'labels' }] } })).toBe(true);
    expect(isRelevantEvent({ eventType: 'avi:jira:updated:issue', changelog: { items: [{ field: 'status' }, { field: 'Comment' }] } })).toBe(false);
  });

  it('let the later of two drafts posted together give way', () => {
    expect(shouldWithdraw('20051', ['20050', '20051'])).toBe(true);
    expect(shouldWithdraw('20050', ['20050', '20051'])).toBe(false);
    expect(shouldWithdraw(undefined, ['20050'])).toBe(false);
  });

  it('read the dates from the start-date field and the due date, and notice an earlier draft', () => {
    const item = parseLeaveItem(raw({ labels: ['leave'], reporter: ADA, customfield_10015: '2026-11-12', duedate: '2026-11-14' }), 'customfield_10015');
    expect(item).toMatchObject({ start: '2026-11-12', end: '2026-11-14', drafted: false });
    const draft = draftHandoverComment(buildBrief(sampleSnapshot('2026-12-01')));
    const again = parseLeaveItem(raw({ labels: ['leave'], reporter: ADA, comment: { comments: [{ id: '30', body: draft, created: '2026-12-01T10:00:00.000Z', author: HR }] } }));
    expect(again?.drafted).toBe(true);
    expect(again?.draftIds).toEqual(['30']);
  });

  it('fall back to sensible dates when the item has none or they are in the past', () => {
    expect(leaveDates(undefined, undefined, '2026-12-01')).toEqual({ start: '2026-12-02', end: '2026-12-06' });
    expect(leaveDates('2026-12-10', '2026-12-12', '2026-12-01')).toEqual({ start: '2026-12-10', end: '2026-12-12' });
    expect(leaveDates('2026-11-20', '2026-11-19', '2026-12-01')).toEqual({ start: '2026-12-02', end: '2026-12-06' });
  });
});

describe('the draft handover comment', () => {
  const b = buildBrief(sampleSnapshot('2026-12-01'));
  const adf = draftHandoverComment(b);
  const json = JSON.stringify(adf);

  it('mentions the person going away, says who covers what and what only they know, and that nothing was sent', () => {
    expect(json).toContain('"id":"sample-nora"');
    expect(json).toContain('Suggested cover: ');
    expect(json).toContain('only you have context on TAX-4');
    expect(json).toContain('Nothing has been sent to anyone.');
    expect(json).toContain('Prepared by Understudy.');
  });

  it('lists keys and names only, never work item summaries', () => {
    for (const x of b.items) expect(json).not.toContain(x.item.summary);
  });

  it('never counts as evidence that its author knows the work', () => {
    const item = parseIssue({
      key: 'FIN-12',
      fields: { summary: 'x', status: { name: 'To Do', statusCategory: { key: 'new' } }, comment: { comments: [{ author: HR, created: '2026-12-01T10:00:00.000Z', body: adf }] } },
    });
    expect(item?.comments).toEqual([]);
  });
});
