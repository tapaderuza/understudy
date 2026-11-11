// The other half of a handover: what happened to someone's work while they
// were away, ordered so the things that need them come first.
import { formatDay } from './dates';
import type { Person, StatusCategory } from './types';

export interface ReturnEvent {
  at: string;
  by: string;
  kind: 'status' | 'assignee' | 'comment' | 'mention';
  text: string;
  /** For assignee changes: the item was handed to the returning person. */
  toYou?: boolean;
}

export interface ReturnItem {
  key: string;
  summary: string;
  url: string;
  status: string;
  statusCategory: StatusCategory;
  assignedToYou: boolean;
  /** Oldest first; only other people's actions since the absence began. */
  events: ReturnEvent[];
  mentionsYou: boolean;
  /** Stand-in named in an Understudy briefing on this item, if any. */
  coveredBy?: string;
}

export type ReturnReason = 'mentioned' | 'reassigned-to-you' | 'reply-waiting' | 'finished' | 'moved' | 'discussed';

export interface ReturnLine extends ReturnItem {
  needsYou: boolean;
  reasons: ReturnReason[];
  lastAt: string;
}

export interface WelcomeBack {
  person: Person;
  since: string;
  today: string;
  headline: string;
  stats: { changed: number; needsYou: number; mentions: number; finished: number; reassigned: number; covered: number };
  items: ReturnLine[];
  /** What was left out or limited, in plain words (watched items skipped, result capped). */
  notes: string[];
}

export const RETURN_LABELS: Record<ReturnReason, string> = {
  mentioned: 'Mentions you',
  'reassigned-to-you': 'Handed to you',
  'reply-waiting': 'Reply waiting',
  finished: 'Finished',
  moved: 'Status changed',
  discussed: 'New comments',
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function buildWelcomeBack(raw: ReturnItem[], person: Person, since: string, today: string, notes: string[] = []): WelcomeBack {
  const items: ReturnLine[] = raw
    .filter((i) => i.events.length > 0 || i.coveredBy)
    .map((i) => {
      const reasons: ReturnReason[] = [];
      if (i.mentionsYou) reasons.push('mentioned');
      if (i.events.some((e) => e.kind === 'assignee' && e.toYou)) reasons.push('reassigned-to-you');
      const last = i.events[i.events.length - 1];
      const replyWaiting = i.assignedToYou && i.statusCategory !== 'done' && (last?.kind === 'comment' || last?.kind === 'mention');
      if (replyWaiting) reasons.push('reply-waiting');
      if (i.statusCategory === 'done' && i.events.some((e) => e.kind === 'status')) reasons.push('finished');
      else if (i.events.some((e) => e.kind === 'status')) reasons.push('moved');
      if (i.events.some((e) => e.kind === 'comment') && !replyWaiting) reasons.push('discussed');
      const needsYou = reasons.includes('mentioned') || reasons.includes('reassigned-to-you') || replyWaiting;
      return { ...i, needsYou, reasons, lastAt: last?.at ?? since };
    })
    .sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || b.lastAt.localeCompare(a.lastAt));

  const stats = {
    changed: items.length,
    needsYou: items.filter((i) => i.needsYou).length,
    mentions: items.filter((i) => i.mentionsYou).length,
    finished: items.filter((i) => i.reasons.includes('finished')).length,
    reassigned: items.filter((i) => i.reasons.includes('reassigned-to-you')).length,
    covered: items.filter((i) => i.coveredBy).length,
  };

  const name = person.displayName;
  let headline: string;
  if (items.length === 0) {
    headline = `Nothing changed on ${name}'s work since ${formatDay(since)}.`;
  } else {
    const parts: string[] = [];
    if (stats.needsYou) parts.push(`${stats.needsYou} need${stats.needsYou === 1 ? 's' : ''} ${name}`);
    if (stats.finished) parts.push(`${stats.finished} finished`);
    if (stats.covered) parts.push(`${stats.covered} covered by a stand-in`);
    headline = `Since ${formatDay(since)}, ${plural(items.length, 'item')} changed${parts.length ? `: ${parts.join(', ')}` : ''}.`;
  }

  return { person, since, today, headline, stats, items, notes };
}

/** Compact JSON for the agent and MCP clients. */
export function toAgentReturnView(w: WelcomeBack) {
  return {
    person: w.person.displayName,
    since: w.since,
    headline: w.headline,
    stats: w.stats,
    needsYou: w.items
      .filter((i) => i.needsYou)
      .slice(0, 15)
      .map((i) => ({
        key: i.key,
        summary: i.summary,
        url: i.url,
        status: i.status,
        why: i.reasons.map((r) => RETURN_LABELS[r]),
        latest: i.events.slice(-3).map((e) => `${e.by}: ${e.text}`),
      })),
    otherChanges: w.items
      .filter((i) => !i.needsYou)
      .slice(0, 20)
      .map((i) => ({ key: i.key, summary: i.summary, status: i.status, what: i.reasons.map((r) => RETURN_LABELS[r]), coveredBy: i.coveredBy ?? null })),
    notes: w.notes,
  };
}
