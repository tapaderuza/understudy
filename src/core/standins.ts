import type { PeerWork, Teammate, WorkItem } from './types';

/** One line of evidence for (or against) a stand-in, with the points it adds. */
export interface Reason {
  text: string;
  points: number;
}

export interface Candidate {
  accountId: string;
  displayName: string;
  /** Final ranking score: context minus the load penalty. */
  score: number;
  /** Points from evidence of context only (never negative). */
  context: number;
  /** Open items they carry, including items already given to them in this plan. */
  load: number;
  reasons: Reason[];
}

export type Confidence = 'high' | 'medium' | 'low';

export interface StandInContext {
  personId: string;
  teammates: Teammate[];
  peerWork: PeerWork[];
  openLoad: Record<string, number>;
}

/** Open items someone can carry before extra work starts to count against them. */
export const LOAD_FREE = 5;
const MAX_LOAD_PENALTY = 6;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function intersect(a: string[], b: Set<string>): string[] {
  return [...new Set(a.filter((x) => b.has(x)))];
}

/**
 * Ranks who could cover one work item while its owner is away. Every point
 * comes with a reason a person can check in Jira, so the suggestion can be
 * trusted or overruled, never taken on faith.
 */
export function rankStandIns(
  item: WorkItem,
  ctx: StandInContext,
  extraLoad: Record<string, number> = {},
  limit = 3,
): Candidate[] {
  const names = new Map<string, string>();
  const consider = (id: string | undefined, name: string | undefined) => {
    if (id && id !== ctx.personId && !names.has(id)) names.set(id, name || 'Unknown user');
  };
  item.comments.forEach((c) => consider(c.accountId, c.displayName));
  consider(item.reporter?.accountId, item.reporter?.displayName);
  ctx.peerWork.forEach((p) => consider(p.accountId, p.displayName));
  ctx.teammates.forEach((t) => consider(t.accountId, t.displayName));

  const out: Candidate[] = [];
  for (const [accountId, displayName] of names) {
    const reasons: Reason[] = [];

    const comments = item.comments.filter((c) => c.accountId === accountId).length;
    if (comments > 0) {
      reasons.push({ text: `Commented ${plural(comments, 'time')} on ${item.key}`, points: Math.min(9, 3 * comments) });
    }
    if (item.reporter?.accountId === accountId) {
      reasons.push({ text: `Reported ${item.key}`, points: 2 });
    }

    const theirs = ctx.peerWork.filter((p) => p.accountId === accountId && p.issueKey !== item.key);
    if (item.parentKey) {
      const siblings = theirs.filter((p) => p.parentKey === item.parentKey).length;
      if (siblings > 0) {
        const where = item.parentSummary ? `${item.parentKey} (${item.parentSummary})` : item.parentKey;
        reasons.push({ text: `Worked on ${plural(siblings, 'other item')} in ${where}`, points: Math.min(6, 3 * siblings) });
      }
    }
    const components = intersect(item.components, new Set(theirs.flatMap((p) => p.components)));
    if (components.length > 0) {
      reasons.push({ text: `Knows the ${components.join(', ')} component${components.length > 1 ? 's' : ''}`, points: Math.min(3, components.length) });
    }
    const labels = intersect(item.labels, new Set(theirs.flatMap((p) => p.labels)));
    if (labels.length > 0) {
      reasons.push({ text: `Works on items labelled ${labels.join(', ')}`, points: Math.min(2, labels.length) });
    }
    const sameProject = theirs.filter((p) => p.projectKey === item.projectKey).length;
    if (sameProject > 0) {
      reasons.push({ text: `Has ${plural(sameProject, 'recent item')} in ${item.projectKey}`, points: Math.min(3, sameProject) });
    }
    const mate = ctx.teammates.find((t) => t.accountId === accountId);
    if (mate) {
      reasons.push({ text: mate.teams[0] ? `In the same team (${mate.teams[0]})` : 'In the same team', points: 1 });
    }

    const context = reasons.reduce((sum, r) => sum + r.points, 0);
    if (context <= 0) continue;

    const load = (ctx.openLoad[accountId] ?? 0) + (extraLoad[accountId] ?? 0);
    const penalty = Math.min(MAX_LOAD_PENALTY, Math.max(0, load - LOAD_FREE) * 0.5);
    if (penalty > 0) reasons.push({ text: `Already carries ${plural(load, 'open item')}`, points: -penalty });

    out.push({ accountId, displayName, score: context - penalty, context, load, reasons });
  }

  out.sort((a, b) => b.score - a.score || a.load - b.load || a.displayName.localeCompare(b.displayName));
  return out.slice(0, limit);
}

/**
 * Points from evidence only, before any load penalty: what an evidence bar
 * should show. Zero for a stand-in chosen by hand with no evidence.
 */
export function contextPointsOf(c: { reasons: Reason[] } | undefined): number {
  return (c?.reasons ?? []).reduce((sum, r) => sum + Math.max(0, r.points), 0);
}

/**
 * How much of the item's context the best stand-in already has. "low" means
 * nobody else has touched this work: it needs a real conversation before
 * the owner leaves, not just a reassignment.
 */
export function confidenceOf(best: Candidate | undefined): Confidence {
  if (!best) return 'low';
  if (best.context >= 6) return 'high';
  if (best.context >= 3) return 'medium';
  return 'low';
}
