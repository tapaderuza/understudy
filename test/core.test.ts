import { describe, expect, it } from 'vitest';
import { buildBrief, toAgentView } from '../src/core/brief';
import { settleBy } from '../src/core/budget';
import { addDays, dayInput, daysBetween, formatDay, isIsoDay, normaliseAbsence, returnSince, todayIn } from '../src/core/dates';
import { REAUTHORISE, UNEXPECTED, UNREACHABLE, apiErrorMessage, userMessage } from '../src/core/errors';
import { renderHandoverPage, standInComment } from '../src/core/render';
import { assessRisk } from '../src/core/risk';
import { confidenceOf, contextPointsOf, rankStandIns } from '../src/core/standins';
import { ANA, BEN, CHEN, DEE, item, snapshot } from './fixtures';

// FIN-12 is work nobody else has touched: the case Understudy exists for.
const withSoloItem = () => {
  const s = snapshot();
  s.workItems.push(
    item({ key: 'FIN-12', summary: 'Quarter-end tax export', status: 'In Progress', statusCategory: 'indeterminate', dueDate: '2026-12-02' }),
  );
  return s;
};

describe('dates', () => {
  it('validates real calendar days only', () => {
    expect(isIsoDay('2026-12-01')).toBe(true);
    expect(isIsoDay('2026-02-30')).toBe(false);
    expect(isIsoDay('1 Dec')).toBe(false);
  });

  it('defaults a missing absence to one week from today and rejects reversed dates', () => {
    expect(normaliseAbsence(undefined, undefined, '2026-11-25')).toEqual({ start: '2026-11-25', end: '2026-12-01' });
    expect(normaliseAbsence('', '  ', '2026-11-25')).toEqual({ start: '2026-11-25', end: '2026-12-01' });
    expect(() => normaliseAbsence('2026-12-10', '2026-12-01', '2026-11-25')).toThrow(
      'The last day away (2026-12-01) is before the first day away (2026-12-10).',
    );
    expect(() => normaliseAbsence(undefined, '2026-11-20', '2026-11-25')).toThrow('is before today (2026-11-25)');
  });

  it('never silently replaces a date that is not YYYY-MM-DD', () => {
    expect(() => normaliseAbsence('next monday', undefined, '2026-11-25')).toThrow("Use dates as YYYY-MM-DD (got 'next monday').");
    expect(() => normaliseAbsence('2026-12-01', '2026-02-30', '2026-11-25')).toThrow("Use dates as YYYY-MM-DD (got '2026-02-30').");
    expect(() => dayInput(20261201)).toThrow("(got '20261201')");
    expect(dayInput(' 2026-12-01 ')).toBe('2026-12-01');
    expect(dayInput(null)).toBeUndefined();
  });

  it('starts a welcome back two weeks ago by default and never in the future', () => {
    expect(returnSince(undefined, '2026-11-25')).toBe('2026-11-11');
    expect(returnSince('2026-11-25', '2026-11-25')).toBe('2026-11-25');
    expect(() => returnSince('2026-11-26', '2026-11-25')).toThrow('The first day away (2026-11-26) is in the future.');
    expect(() => returnSince('last week', '2026-11-25')).toThrow("Use dates as YYYY-MM-DD (got 'last week').");
  });

  it("computes today in the person's time zone, falling back to UTC", () => {
    const lateEvening = new Date('2026-11-11T20:00:00Z');
    expect(todayIn('Pacific/Kiritimati', lateEvening)).toBe('2026-11-12'); // UTC+14
    expect(todayIn('America/Los_Angeles', new Date('2026-11-12T03:00:00Z'))).toBe('2026-11-11');
    expect(todayIn(undefined, lateEvening)).toBe('2026-11-11');
    expect(todayIn('Not/AZone', lateEvening)).toBe('2026-11-11');
  });

  it('does day arithmetic across month ends', () => {
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03');
    expect(daysBetween('2026-11-24T09:00:00.000Z', '2026-11-25')).toBe(1);
    expect(formatDay('2026-12-03')).toBe('3 Dec 2026');
  });
});

describe('assessRisk', () => {
  const s = snapshot();
  const byKey = (k: string) => s.workItems.find((w) => w.key === k)!;

  it('flags an in-flight item that falls due while away, with an open PR and an unanswered comment', () => {
    const r = assessRisk(byKey('PAY-101'), ANA.accountId, s.absence, s.today);
    expect(r.flags).toEqual(['due-while-away', 'high-priority', 'open-pr', 'waiting-on-them', 'in-progress']);
    expect(r.tier).toBe('must');
    expect(r.score).toBe(16);
  });

  it('treats an overdue top-priority item as must cover', () => {
    const r = assessRisk(byKey('OPS-7'), ANA.accountId, s.absence, s.today);
    expect(r.flags).toEqual(['overdue', 'high-priority']);
    expect(r.tier).toBe('must');
  });

  it('lets low-priority backlog wait', () => {
    expect(assessRisk(byKey('PAY-110'), ANA.accountId, s.absence, s.today).tier).toBe('can-wait');
  });

  it('does not count the owner\'s own latest comment as someone waiting', () => {
    const own = item({ key: 'X-1', summary: 'x', comments: [{ ...ANA, at: '2026-11-24T00:00:00.000Z' }] });
    expect(assessRisk(own, ANA.accountId, s.absence, s.today).flags).not.toContain('waiting-on-them');
  });
});

describe('rankStandIns', () => {
  const s = snapshot();
  const ctx = { personId: ANA.accountId, teammates: s.teammates, peerWork: s.peerWork, openLoad: s.openLoad };
  const pay101 = s.workItems.find((w) => w.key === 'PAY-101')!;

  it('prefers the person with the most checkable context and explains why', () => {
    const [best, second] = rankStandIns(pay101, ctx);
    expect(best?.accountId).toBe(BEN.accountId);
    expect(best?.context).toBe(16);
    expect(best?.score).toBe(14); // 9 open items costs 2 points
    expect(best?.reasons.map((r) => r.text)).toEqual([
      'Commented 2 times on PAY-101',
      'Worked on 2 other items in PAY-100 (Refunds v2)',
      'Knows the Payments component',
      'Has 2 recent items in PAY',
      'In the same team (Payments squad)',
      'Already carries 9 open items',
    ]);
    expect(second?.accountId).toBe(CHEN.accountId);
  });

  it('never suggests the person who is leaving', () => {
    expect(rankStandIns(pay101, ctx, {}, 10).map((c) => c.accountId)).not.toContain(ANA.accountId);
  });

  it('spreads work away from an overloaded expert', () => {
    const pay102 = s.workItems.find((w) => w.key === 'PAY-102')!;
    expect(rankStandIns(pay102, ctx)[0]?.accountId).toBe(BEN.accountId);
    const busy = { ...ctx, openLoad: { ...ctx.openLoad, [BEN.accountId]: 14 } };
    expect(rankStandIns(pay102, busy)[0]?.accountId).toBe(CHEN.accountId);
  });

  it('exposes the evidence points apart from the load penalty', () => {
    const [best] = rankStandIns(pay101, ctx);
    expect(contextPointsOf(best)).toBe(16);
    expect(contextPointsOf({ reasons: [{ text: 'Chosen by hand', points: 0 }] })).toBe(0);
    expect(contextPointsOf(undefined)).toBe(0);
  });

  it('grades confidence by context, not by score', () => {
    expect(confidenceOf(undefined)).toBe('low');
    expect(confidenceOf({ accountId: 'a', displayName: 'a', score: -1, context: 6, load: 20, reasons: [] })).toBe('high');
    expect(confidenceOf({ accountId: 'a', displayName: 'a', score: 3, context: 3, load: 0, reasons: [] })).toBe('medium');
  });
});

describe('buildBrief', () => {
  it('orders work by urgency, balances the plan and finds knowledge only the owner has', () => {
    const b = buildBrief(withSoloItem());
    expect(b.items.map((x) => x.item.key)).toEqual(['PAY-101', 'OPS-7', 'FIN-12', 'PAY-102', 'PAY-110']);
    expect(b.items.map((x) => x.standIn?.displayName)).toEqual([BEN.displayName, DEE.displayName, CHEN.displayName, BEN.displayName, CHEN.displayName]);
    expect(b.soloKnowledge).toEqual(['FIN-12']);
    expect(b.cover).toEqual([
      { accountId: BEN.accountId, displayName: BEN.displayName, itemKeys: ['PAY-101', 'PAY-102'] },
      { accountId: DEE.accountId, displayName: DEE.displayName, itemKeys: ['OPS-7'] },
      { accountId: CHEN.accountId, displayName: CHEN.displayName, itemKeys: ['FIN-12'] },
    ]);
    expect(b.stats).toEqual({
      open: 5,
      planned: 5,
      must: 3,
      should: 1,
      canWait: 1,
      dueWhileAway: 2,
      overdue: 1,
      openPullRequests: 1,
      soloKnowledge: 1,
      standIns: 3,
    });
    expect(b.headline).toBe(
      'Ana Ruiz has 5 open items: 3 must be covered from 1 Dec 2026, 2 fall due by 5 Dec 2026, 1 already overdue, 1 only Ana Ruiz has context on.',
    );
  });

  it('respects a stand-in chosen by hand, even one with no recorded context', () => {
    const b = buildBrief(withSoloItem(), { 'OPS-7': CHEN.accountId, 'FIN-12': 'acc-zoe' });
    const ops = b.items.find((x) => x.item.key === 'OPS-7')!;
    expect(ops.standIn?.accountId).toBe(CHEN.accountId);
    expect(ops.chosenByHand).toBe(true);
    const fin = b.items.find((x) => x.item.key === 'FIN-12')!;
    expect(fin.standIn).toMatchObject({ accountId: 'acc-zoe', displayName: 'Chosen stand-in' });
  });

  it('says when the plan covers only the most urgent part of a long list', () => {
    const b = buildBrief(snapshot({ openTotal: 987 }));
    expect(b.stats).toMatchObject({ open: 987, planned: 4 });
    expect(b.headline.startsWith('Ana Ruiz has 987 open items (this plan covers the 4 most urgent): ')).toBe(true);
  });

  it('keeps a very busy colleague from being suggested over one with room', () => {
    const busy = snapshot({ openLoad: { [BEN.accountId]: 160, [CHEN.accountId]: 2, [DEE.accountId]: 3 } });
    const ranked = rankStandIns(busy.workItems[1]!, { personId: ANA.accountId, teammates: busy.teammates, peerWork: busy.peerWork, openLoad: busy.openLoad });
    expect(ranked[0]?.displayName).toBe(CHEN.displayName);
    expect(ranked.find((c) => c.accountId === BEN.accountId)?.reasons.at(-1)).toEqual({ text: 'Already carries 160 open items', points: -6 });
  });

  it('leaves the choice to a person when everyone with context is overloaded', () => {
    const b = buildBrief(
      snapshot({
        workItems: [item({ key: 'LEO-1', summary: 'Privacy review', priority: 'High', reporter: BEN })],
        teammates: [],
        peerWork: [],
        openLoad: { [BEN.accountId]: 40 },
      }),
    );
    const leo = b.items[0]!;
    expect(leo.standIn).toBeUndefined();
    expect(leo.alternatives.map((c) => c.displayName)).toEqual([BEN.displayName]);
    expect(b.cover).toEqual([]);
    expect(b.soloKnowledge).toEqual(['LEO-1']);
  });

  it('handles someone with nothing assigned', () => {
    const b = buildBrief(snapshot({ workItems: [] }));
    expect(b.stats.open).toBe(0);
    expect(b.headline).toBe('Ana Ruiz has no open Jira work assigned, so there is nothing to cover in Jira.');
  });

  it('gives agents a compact view with reasons they can repeat', () => {
    const v = toAgentView(buildBrief(withSoloItem()));
    expect(v.coverPlan).toHaveLength(4);
    expect(v.coverPlan[0]).toMatchObject({ key: 'PAY-101', suggestedStandIn: { name: BEN.displayName }, confidence: 'high' });
    expect(v.canWait).toEqual([{ key: 'PAY-110', summary: 'Update README badges' }]);
    expect(v.onlyThisPersonHasContext).toEqual(['FIN-12']);
    expect(JSON.stringify(v).length).toBeLessThan(8000);
  });
});

describe('render', () => {
  it('writes a Confluence page that mentions stand-ins and escapes user text', () => {
    const s = withSoloItem();
    s.workItems[0]!.summary = 'Fix <script> & "quotes"';
    const page = renderHandoverPage(buildBrief(s));
    expect(page.title).toBe('Handover: Ana Ruiz, 1 Dec 2026 to 5 Dec 2026');
    expect(page.body).toContain('Fix &lt;script&gt; &amp; &quot;quotes&quot;');
    expect(page.body).not.toContain('<script>');
    expect(page.body).toContain('<ri:user ri:account-id="acc-ben" />');
    expect(page.body).toContain('Only Ana Ruiz has context on this item.');
    expect(page.body).toContain('Code in flight');
  });

  it('writes a Jira comment that @-mentions the stand-in', () => {
    const doc = standInComment({
      itemKey: 'PAY-101',
      standIn: BEN,
      ownerName: ANA.displayName,
      absence: { start: '2026-12-01', end: '2026-12-05' },
      whyItMatters: ['Due while away'],
      because: ['Commented 2 times on PAY-101'],
      note: 'PR needs one more review.',
    }) as { content: Array<{ content: Array<Record<string, unknown>> }> };
    expect(doc.content[0]!.content[0]).toEqual({ type: 'mention', attrs: { id: BEN.accountId, text: `@${BEN.displayName}` } });
    expect(JSON.stringify(doc)).toContain('you are covering PAY-101 while Ana Ruiz is away (1 Dec 2026 to 5 Dec 2026).');
    expect(JSON.stringify(doc)).toContain('PR needs one more review.');
  });
});

describe('errors people see', () => {
  it('gives each API status a plain message', () => {
    expect(apiErrorMessage('jira', 401)).toBe(REAUTHORISE);
    expect(apiErrorMessage('jira', 403)).toBe("You don't have permission to do this in Jira.");
    expect(apiErrorMessage('confluence', 403)).toBe("You don't have permission to do this in Confluence.");
    expect(apiErrorMessage('jira', 404)).toBe("Not found, or you don't have access to it.");
    expect(apiErrorMessage('confluence', 409, 'create-page')).toBe('A page with this title already exists.');
    expect(apiErrorMessage('jira', 429)).toBe('Atlassian is busy right now. Try again in a minute.');
    expect(apiErrorMessage('confluence', 503)).toBe('Confluence had a temporary problem. Try again.');
    expect(apiErrorMessage('jira', 500)).toBe('Jira had a temporary problem. Try again.');
  });

  it('keeps its own messages and hides anything unexpected', () => {
    expect(userMessage(new Error('Pick a stand-in first.'))).toBe('Pick a stand-in first.');
    expect(userMessage(new TypeError("Cannot read properties of undefined (reading 'fields')"))).toBe(UNEXPECTED);
    expect(userMessage('boom')).toBe(UNEXPECTED);
    const forge = (name: string) => Object.assign(new Error('Authentication Required'), { name });
    expect(userMessage(forge('NEEDS_AUTHENTICATION_ERR'))).toBe(REAUTHORISE);
    expect(userMessage(forge('FUNCTION_FETCH_ERR'))).toBe(UNREACHABLE);
  });
});

describe('settleBy', () => {
  it('reports a value, an error or a late answer, and never rejects', async () => {
    const soon = Date.now() + 1_000;
    expect(await settleBy(soon, async () => 7)).toEqual({ state: 'ok', value: 7 });
    const failed = await settleBy(soon, async () => {
      throw new Error('no');
    });
    expect(failed.state).toBe('error');
    expect(await settleBy(Date.now() + 20, () => new Promise(() => undefined))).toEqual({ state: 'timeout' });
  });

  it('does not start work once the deadline has passed', async () => {
    let started = false;
    const r = await settleBy(Date.now() - 1, async () => {
      started = true;
      return 1;
    });
    expect(r).toEqual({ state: 'timeout' });
    expect(started).toBe(false);
  });
});
