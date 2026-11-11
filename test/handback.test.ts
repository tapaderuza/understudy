import { describe, expect, it } from 'vitest';
import { adfMentions, adfText, parseReturnIssue } from '../src/adapters/parse';
import { buildWelcomeBack, toAgentReturnView } from '../src/core/handback';
import { standInComment } from '../src/core/render';

const ANA = { accountId: '712020:ana', displayName: 'Ana Ruiz' };
const BEN = { accountId: '712020:ben', displayName: 'Ben Okafor' };
const SINCE = '2026-12-01';

const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content }] });
const text = (t: string) => ({ type: 'text', text: t });
const mention = (p: { accountId: string; displayName: string }) => ({ type: 'mention', attrs: { id: p.accountId, text: `@${p.displayName}` } });

function issue(key: string, opts: { status?: string; cat?: string; assignee?: string; histories?: unknown[]; comments?: unknown[] }) {
  return {
    id: key.replace(/\D/g, ''),
    key,
    self: `https://example.atlassian.net/rest/api/3/issue/${key}`,
    fields: {
      summary: `Summary of ${key}`,
      status: { name: opts.status ?? 'In Progress', statusCategory: { key: opts.cat ?? 'indeterminate' } },
      assignee: opts.assignee ? { accountId: opts.assignee } : null,
      comment: { comments: opts.comments ?? [] },
    },
    changelog: { histories: opts.histories ?? [] },
  };
}

describe('ADF helpers', () => {
  it('reads text and mentions from a comment body', () => {
    const body = doc(mention(ANA), text(' can you check the JPY case?'));
    expect(adfText(body)).toBe('@Ana Ruiz can you check the JPY case?');
    expect(adfMentions(body)).toEqual([ANA.accountId]);
  });
});

describe('parseReturnIssue', () => {
  it('keeps only what other people did since the first day away', () => {
    const raw = issue('PAY-101', {
      assignee: ANA.accountId,
      histories: [
        { author: BEN, created: '2026-11-30T10:00:00.000+0000', items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
        { author: BEN, created: '2026-12-02T10:00:00.000+0000', items: [{ field: 'status', fromString: 'In Progress', toString: 'In Review' }] },
        { author: ANA, created: '2026-12-03T10:00:00.000+0000', items: [{ field: 'status', fromString: 'In Review', toString: 'In Progress' }] },
      ],
      comments: [
        { author: BEN, created: '2026-12-04T09:00:00.000+0000', body: doc(mention(ANA), text(' JPY still open, needs your call.')) },
      ],
    });
    const r = parseReturnIssue(raw, ANA.accountId, SINCE)!;
    expect(r.events.map((e) => [e.kind, e.by, e.text])).toEqual([
      ['status', 'Ben Okafor', 'In Progress → In Review'],
      ['mention', 'Ben Okafor', '@Ana Ruiz JPY still open, needs your call.'],
    ]);
    expect(r.mentionsYou).toBe(true);
    expect(r.assignedToYou).toBe(true);
  });

  it('recognises an Understudy briefing and records who covered the item', () => {
    const briefing = standInComment({
      itemKey: 'OPS-7',
      standIn: BEN,
      ownerName: ANA.displayName,
      absence: { start: SINCE, end: '2026-12-05' },
      whyItMatters: [],
      because: [],
    });
    const raw = issue('OPS-7', { comments: [{ author: { accountId: '712020:chen', displayName: 'Chen Wei' }, created: '2026-12-01T08:00:00.000+0000', body: briefing }] });
    const r = parseReturnIssue(raw, ANA.accountId, SINCE)!;
    expect(r.coveredBy).toBe('Ben Okafor');
    expect(r.events).toEqual([]);
  });
});

describe('buildWelcomeBack', () => {
  const items = [
    parseReturnIssue(
      issue('PAY-101', {
        assignee: ANA.accountId,
        comments: [{ author: BEN, created: '2026-12-04T09:00:00.000+0000', body: doc(mention(ANA), text(' needs your call')) }],
      }),
      ANA.accountId,
      SINCE,
    )!,
    parseReturnIssue(
      issue('PAY-102', {
        status: 'Done',
        cat: 'done',
        histories: [{ author: BEN, created: '2026-12-03T10:00:00.000+0000', items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }] }],
      }),
      ANA.accountId,
      SINCE,
    )!,
    parseReturnIssue(
      issue('PAY-103', {
        histories: [{ author: BEN, created: '2026-12-02T10:00:00.000+0000', items: [{ field: 'assignee', from: BEN.accountId, fromString: 'Ben Okafor', to: ANA.accountId, toString: 'Ana Ruiz' }] }],
      }),
      ANA.accountId,
      SINCE,
    )!,
    parseReturnIssue(issue('PAY-104', {}), ANA.accountId, SINCE)!,
  ];

  it('puts what needs the person first and drops untouched work', () => {
    const w = buildWelcomeBack(items, ANA, SINCE, '2026-12-08');
    expect(w.items.map((i) => [i.key, i.needsYou, i.reasons])).toEqual([
      ['PAY-101', true, ['mentioned', 'reply-waiting']],
      ['PAY-103', true, ['reassigned-to-you']],
      ['PAY-102', false, ['finished']],
    ]);
    expect(w.stats).toEqual({ changed: 3, needsYou: 2, mentions: 1, finished: 1, reassigned: 1, covered: 0 });
    expect(w.headline).toBe('Since 1 Dec 2026, 3 items changed: 2 need Ana Ruiz, 1 finished.');
  });

  it('says plainly when nothing changed', () => {
    expect(buildWelcomeBack([], ANA, SINCE, '2026-12-08').headline).toBe("Nothing changed on Ana Ruiz's work since 1 Dec 2026.");
  });

  it('gives agents a compact view', () => {
    const v = toAgentReturnView(buildWelcomeBack(items, ANA, SINCE, '2026-12-08'));
    expect(v.needsYou.map((i) => i.key)).toEqual(['PAY-101', 'PAY-103']);
    expect(v.needsYou[0]!.why).toEqual(['Mentions you', 'Reply waiting']);
    expect(v.otherChanges).toEqual([{ key: 'PAY-102', summary: 'Summary of PAY-102', status: 'Done', what: ['Finished'], coveredBy: null }]);
  });
});
