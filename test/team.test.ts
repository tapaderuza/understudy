import { describe, expect, it } from 'vitest';
import { walkthroughComment } from '../src/core/render';
import { buildTeamRisk, teamHeadline, toAgentTeamView, type TeamSnapshot } from '../src/core/team';
import type { PeerWork } from '../src/core/types';
import { findBriefing, parseIssue } from '../src/adapters/parse';
import { parseStandInChoices } from '../src/core/choices';
import { standInComment } from '../src/core/render';
import { ANA, BEN, CHEN, DEE, item } from './fixtures';

const peer = (who: { accountId: string; displayName: string }, issueKey: string, extra: Partial<PeerWork> = {}): PeerWork => ({
  ...who,
  issueKey,
  projectKey: issueKey.split('-')[0] ?? 'X',
  labels: [],
  components: [],
  updated: '2026-11-15T10:00:00.000Z',
  ...extra,
});

// Ana holds two things alone (one urgent); Ben has a backup for his work.
function team(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    projects: ['PAY'],
    today: '2026-11-25',
    items: [
      {
        owner: ANA,
        item: item({
          key: 'PAY-1',
          summary: 'Month-end refund reconciliation',
          priority: 'High',
          dueDate: '2026-12-01',
          parentKey: 'PAY-100',
          comments: [
            { ...BEN, at: '2026-11-20T09:00:00.000Z' },
            { ...BEN, at: '2026-11-21T09:00:00.000Z' },
          ],
        }),
      },
      { owner: ANA, item: item({ key: 'PAY-2', summary: 'Vendor contract renewal', priority: 'Highest', dueDate: '2026-11-30' }) },
      { owner: ANA, item: item({ key: 'PAY-3', summary: 'Archive old invoices', priority: 'Low' }) },
      {
        owner: BEN,
        item: item({ key: 'PAY-4', summary: 'Supplier onboarding checklist', parentKey: 'PAY-200', comments: [{ ...CHEN, at: '2026-11-22T09:00:00.000Z' }] }),
      },
      { owner: BEN, item: item({ key: 'PAY-5', summary: 'Closed already', status: 'Done', statusCategory: 'done' }) },
    ],
    peerWork: [
      peer(CHEN, 'PAY-201', { parentKey: 'PAY-200' }),
      peer(DEE, 'PAY-301'),
      peer(ANA, 'PAY-1', { parentKey: 'PAY-100' }),
    ],
    openLoad: { [BEN.accountId]: 3, [CHEN.accountId]: 2, [DEE.accountId]: 1 },
    notes: [],
    ...overrides,
  };
}

describe('buildTeamRisk', () => {
  it('finds the open items only their owner has context on, most urgent first', () => {
    const t = buildTeamRisk(team());
    expect(t.atRisk.map((x) => x.item.key)).toEqual(['PAY-2', 'PAY-3']);
    expect(t.stats).toMatchObject({ open: 4, checked: 4, people: 2, solo: 2, soloUrgent: 1, readiness: 50 });
    expect(t.window).toEqual({ start: '2026-11-25', end: '2026-12-08' });
  });

  it('ranks people by urgent knowledge only they hold and names their best backup', () => {
    const t = buildTeamRisk(team());
    const [ana, ben] = t.people;
    expect(ana?.person.displayName).toBe('Ana Ruiz');
    expect(ana).toMatchObject({ open: 3, solo: ['PAY-2', 'PAY-3'], soloUrgent: ['PAY-2'], readiness: 33 });
    expect(ana?.backup).toMatchObject({ displayName: 'Ben Okafor', couldCover: 1 });
    expect(ben).toMatchObject({ open: 1, solo: [], readiness: 100 });
    expect(ben?.backup?.displayName).toBe('Chen Wei');
  });

  it('keeps the closest colleague even when their evidence is thin, without counting the owner', () => {
    const t = buildTeamRisk(team());
    const pay3 = t.atRisk.find((x) => x.item.key === 'PAY-3');
    expect(pay3?.confidence).toBe('low');
    expect(pay3?.closest?.accountId).not.toBe(ANA.accountId);
    expect(pay3?.closest?.context ?? 0).toBeLessThan(3);
  });

  it('says plainly when there is nothing at risk or nothing to check', () => {
    expect(buildTeamRisk(team({ items: [] })).headline).toBe('Nobody has open assigned work in PAY, so no knowledge is at risk there.');
    const covered = buildTeamRisk(team({ items: team().items.filter((o) => o.item.key === 'PAY-4') }));
    expect(covered.headline).toBe('Every open item in PAY has someone else with context on it: cover readiness is 100%.');
    expect(covered.stats.readiness).toBe(100);
  });

  it('writes a headline with the totals and the person who holds the most', () => {
    expect(buildTeamRisk(team()).headline).toBe(
      'Only one person has context on 2 of the 4 open items in PAY, 1 of them due or urgent in the next two weeks. Ana Ruiz holds the most: 2 of 3 items.',
    );
    const capped = teamHeadline(['PAY', 'OPS'], { open: 240, checked: 100, people: 9, solo: 31, soloUrgent: 0, readiness: 69 }, undefined);
    expect(capped).toBe('Only one person has context on 31 of the 100 most urgent open items in PAY, OPS.');
  });

  it('gives agents a compact view with team wording for dates', () => {
    const v = toAgentTeamView(buildTeamRisk(team()));
    expect(v.coverReadinessPercent).toBe(50);
    expect(v.people[0]).toMatchObject({ name: 'Ana Ruiz', onlyTheyKnow: ['PAY-2', 'PAY-3'], bestBackup: { name: 'Ben Okafor', couldCover: 1 } });
    const pay2 = v.knowledgeAtRisk.find((x) => x.key === 'PAY-2');
    expect(pay2?.whyItMatters).toContain('Due in the next 2 weeks');
    expect(pay2?.owner).toBe('Ana Ruiz');
  });
});

describe('walkthrough requests', () => {
  const adf = walkthroughComment({
    itemKey: 'PAY-2',
    owner: ANA,
    learner: DEE,
    whyItMatters: ['Due in the next 2 weeks', 'High priority'],
  });

  it('mentions the owner and the colleague and says why it matters', () => {
    const json = JSON.stringify(adf);
    expect(json).toContain('"id":"acc-ana"');
    expect(json).toContain('"id":"acc-dee"');
    expect(json).toContain('15-minute walkthrough of PAY-2');
    expect(json).toContain('Requested with Understudy.');
  });

  it('is read back as a pending walkthrough and never as evidence that its sender knows the work', () => {
    const raw = {
      key: 'PAY-2',
      self: 'https://example.atlassian.net/rest/api/3/issue/2',
      fields: {
        summary: 'Vendor contract renewal',
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        comment: {
          comments: [
            { author: { accountId: BEN.accountId, displayName: BEN.displayName, accountType: 'atlassian' }, created: '2026-11-25T10:00:00.000Z', body: adf },
          ],
        },
      },
    };
    const parsed = parseIssue(raw);
    expect(parsed?.comments).toEqual([]);
    expect(parsed?.walkthrough).toEqual({ learner: 'Dee Patel', learnerId: DEE.accountId, at: '2026-11-25T10:00:00.000Z' });
  });
});

describe('stand-ins chosen in chat', () => {
  it('reads key and person pairs in the forms people type', () => {
    expect(parseStandInChoices('PAY-3=Max Taylor; pay-5: Cassi Owens, OPS-1 -> Ryan Lee\nFIN-2 to "Ada"')).toEqual([
      { key: 'PAY-3', who: 'Max Taylor' },
      { key: 'PAY-5', who: 'Cassi Owens' },
      { key: 'OPS-1', who: 'Ryan Lee' },
      { key: 'FIN-2', who: 'Ada' },
    ]);
  });

  it('keeps commas inside a name, lets the last choice win and ignores noise', () => {
    expect(parseStandInChoices('PAY-3=Okafor, Ben; PAY-3=Chen Wei; hello; =x')).toEqual([{ key: 'PAY-3', who: 'Chen Wei' }]);
    expect(parseStandInChoices(undefined)).toEqual([]);
    expect(parseStandInChoices('   ')).toEqual([]);
  });
});

describe('an earlier briefing', () => {
  const briefing = (standIn: { accountId: string; displayName: string }, created: string, id: string, author = ANA) => ({
    id,
    created,
    author: { accountId: author.accountId, displayName: author.displayName, accountType: 'atlassian' },
    body: standInComment({ itemKey: 'PAY-2', standIn, ownerName: ANA.displayName, whyItMatters: [], because: [] }),
  });

  it('is found for the same stand-in, the latest one, with its author', () => {
    const raw = {
      fields: {
        comment: {
          comments: [
            briefing(BEN, '2026-11-20T09:00:00.000Z', '10'),
            briefing(CHEN, '2026-11-21T09:00:00.000Z', '11'),
            briefing(BEN, '2026-11-22T09:00:00.000Z', '12', DEE),
          ],
        },
      },
    };
    expect(findBriefing(raw, BEN.accountId)).toEqual({ id: '12', authorId: DEE.accountId, at: '2026-11-22T09:00:00.000Z' });
    expect(findBriefing(raw, CHEN.accountId)?.id).toBe('11');
    expect(findBriefing(raw, DEE.accountId)).toBeUndefined();
  });
});

describe('signatures', () => {
  it('only count as the last paragraph, so a note cannot fake a briefing', () => {
    const spoof = walkthroughComment({ itemKey: 'PAY-2', owner: ANA, learner: DEE, whyItMatters: [], note: 'Sent with Understudy' });
    const raw = {
      fields: {
        comment: {
          comments: [{ id: '20', created: '2026-11-25T10:00:00.000Z', author: { accountId: BEN.accountId, displayName: BEN.displayName }, body: spoof }],
        },
      },
    };
    expect(findBriefing(raw, ANA.accountId)).toBeUndefined();
  });

  it('treat a recent walkthrough for the same colleague as already asked, and an old one as not', async () => {
    const { isRecentWalkthrough } = await import('../src/service');
    const w = { learner: 'Dee Patel', learnerId: DEE.accountId, at: '2026-11-20T10:00:00.000Z' };
    expect(isRecentWalkthrough(w, DEE.accountId, '2026-11-25')).toBe(true);
    expect(isRecentWalkthrough(w, BEN.accountId, '2026-11-25')).toBe(false);
    expect(isRecentWalkthrough(w, DEE.accountId, '2026-12-20')).toBe(false);
    expect(isRecentWalkthrough(undefined, DEE.accountId, '2026-11-25')).toBe(false);
  });
});
