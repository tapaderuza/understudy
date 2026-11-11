import { daysBetween } from './dates';
import type { Absence, WorkItem } from './types';

export type RiskFlag =
  | 'overdue'
  | 'due-while-away'
  | 'blocked'
  | 'high-priority'
  | 'open-pr'
  | 'waiting-on-them'
  | 'in-progress';

export type Tier = 'must' | 'should' | 'can-wait';

export interface RiskAssessment {
  flags: RiskFlag[];
  score: number;
  tier: Tier;
}

/** Points per flag. Order of this table is also the display order. */
export const RISK_WEIGHTS: Record<RiskFlag, number> = {
  overdue: 5,
  'due-while-away': 5,
  blocked: 4,
  'high-priority': 3,
  'open-pr': 3,
  'waiting-on-them': 3,
  'in-progress': 2,
};

export const RISK_LABELS: Record<RiskFlag, string> = {
  overdue: 'Overdue',
  'due-while-away': 'Due while away',
  blocked: 'Blocked',
  'high-priority': 'High priority',
  'open-pr': 'Open pull request',
  'waiting-on-them': 'Someone is waiting for a reply',
  'in-progress': 'In progress',
};

const HIGH_PRIORITIES = new Set(['highest', 'high', 'blocker', 'critical', 'urgent', 'p0', 'p1']);

/** A reply counts as "waiting" when the latest comment is someone else's and this recent. */
const WAITING_WINDOW_DAYS = 14;

export function assessRisk(item: WorkItem, personId: string, absence: Absence, today: string): RiskAssessment {
  const flags: RiskFlag[] = [];

  if (item.dueDate) {
    if (item.dueDate < today) flags.push('overdue');
    else if (item.dueDate <= absence.end) flags.push('due-while-away');
  }
  if (item.blocked || /block/i.test(item.status)) flags.push('blocked');
  if (item.priority && HIGH_PRIORITIES.has(item.priority.trim().toLowerCase())) flags.push('high-priority');
  if (item.pullRequests.some((pr) => pr.status === 'OPEN' || pr.status === 'DRAFT')) flags.push('open-pr');

  const last = item.comments[item.comments.length - 1];
  if (last && last.accountId !== personId && daysBetween(last.at, today) <= WAITING_WINDOW_DAYS) {
    flags.push('waiting-on-them');
  }
  if (item.statusCategory === 'indeterminate') flags.push('in-progress');

  const ordered = (Object.keys(RISK_WEIGHTS) as RiskFlag[]).filter((f) => flags.includes(f));
  const score = ordered.reduce((sum, f) => sum + RISK_WEIGHTS[f], 0);
  const tier: Tier = score >= 5 ? 'must' : score >= 2 ? 'should' : 'can-wait';
  return { flags: ordered, score, tier };
}
