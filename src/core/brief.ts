import { formatDay } from './dates';
import { RISK_LABELS, assessRisk, type RiskAssessment, type Tier } from './risk';
import { confidenceOf, rankStandIns, type Candidate, type Confidence, type StandInContext } from './standins';
import type { Absence, Goal, Page, Person, PullRequest, Snapshot, Sources, WorkItem } from './types';

export interface BriefItem {
  item: WorkItem;
  risk: RiskAssessment;
  standIn?: Candidate;
  alternatives: Candidate[];
  confidence: Confidence;
  /** True when the stand-in was picked by a person rather than suggested. */
  chosenByHand: boolean;
}

export interface CoverLoad {
  accountId: string;
  displayName: string;
  itemKeys: string[];
}

export interface BriefStats {
  /** Every open item the person has. */
  open: number;
  /** Items in this plan: the most urgent ones when there are too many to read. */
  planned: number;
  must: number;
  should: number;
  canWait: number;
  dueWhileAway: number;
  overdue: number;
  openPullRequests: number;
  soloKnowledge: number;
  standIns: number;
}

export interface Brief {
  person: Person;
  absence: Absence;
  today: string;
  siteUrl?: string;
  headline: string;
  stats: BriefStats;
  items: BriefItem[];
  /** Keys of items that matter and that nobody else has context on. */
  soloKnowledge: string[];
  cover: CoverLoad[];
  pullRequests: PullRequest[];
  goals: Goal[];
  pages: Page[];
  sources: Sources;
}

const TIER_ORDER: Record<Tier, number> = { must: 0, should: 1, 'can-wait': 2 };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function byUrgency(a: { item: WorkItem; risk: RiskAssessment }, b: { item: WorkItem; risk: RiskAssessment }): number {
  return (
    TIER_ORDER[a.risk.tier] - TIER_ORDER[b.risk.tier] ||
    b.risk.score - a.risk.score ||
    (a.item.dueDate ?? '9999').localeCompare(b.item.dueDate ?? '9999') ||
    a.item.key.localeCompare(b.item.key, undefined, { numeric: true })
  );
}

function dedupePullRequests(prs: PullRequest[]): PullRequest[] {
  const seen = new Map<string, PullRequest>();
  for (const pr of prs) {
    const id = pr.url || pr.id;
    const prev = seen.get(id);
    seen.set(id, prev ? { ...prev, workItemKey: prev.workItemKey ?? pr.workItemKey } : pr);
  }
  const rank = (p: PullRequest) => (p.status === 'OPEN' ? 0 : p.status === 'DRAFT' ? 1 : 2);
  return [...seen.values()].sort((a, b) => rank(a) - rank(b) || (b.updated ?? '').localeCompare(a.updated ?? ''));
}

function nameFor(accountId: string, s: Snapshot): string | undefined {
  return (
    s.teammates.find((t) => t.accountId === accountId)?.displayName ??
    s.peerWork.find((p) => p.accountId === accountId)?.displayName ??
    s.workItems.flatMap((w) => w.comments).find((c) => c.accountId === accountId)?.displayName
  );
}

/**
 * Turns a snapshot into a cover plan. Items are taken in order of urgency and
 * each one adds to its stand-in's load, so the plan spreads the work instead
 * of handing everything to the most experienced person.
 *
 * @param overrides issue key -> accountId chosen by hand in the UI
 */
export function buildBrief(s: Snapshot, overrides: Record<string, string> = {}): Brief {
  const ctx: StandInContext = {
    personId: s.person.accountId,
    teammates: s.teammates,
    peerWork: s.peerWork,
    openLoad: s.openLoad,
  };

  const assessed = s.workItems
    .filter((item) => item.statusCategory !== 'done')
    .map((item) => ({ item, risk: assessRisk(item, s.person.accountId, s.absence, s.today) }))
    .sort(byUrgency);

  const extraLoad: Record<string, number> = {};
  const items: BriefItem[] = assessed.map(({ item, risk }) => {
    const ranked = rankStandIns(item, ctx, extraLoad, 4);
    const chosenId = overrides[item.key];
    // A suggestion needs more context than load. When everyone who knows the
    // work is already overloaded, a person should decide, not the ranking.
    let standIn = ranked[0] && ranked[0].score > 0 ? ranked[0] : undefined;
    let chosenByHand = false;
    if (chosenId && chosenId !== s.person.accountId) {
      standIn =
        ranked.find((c) => c.accountId === chosenId) ??
        rankStandIns(item, ctx, extraLoad, 50).find((c) => c.accountId === chosenId) ?? {
          accountId: chosenId,
          displayName: nameFor(chosenId, s) ?? 'Chosen stand-in',
          score: 0,
          context: 0,
          load: s.openLoad[chosenId] ?? 0,
          reasons: [{ text: 'Chosen by hand', points: 0 }],
        };
      chosenByHand = true;
    }
    if (standIn && risk.tier !== 'can-wait') {
      extraLoad[standIn.accountId] = (extraLoad[standIn.accountId] ?? 0) + 1;
    }
    return {
      item,
      risk,
      standIn,
      alternatives: ranked.filter((c) => c.accountId !== standIn?.accountId).slice(0, 3),
      confidence: confidenceOf(standIn),
      chosenByHand,
    };
  });

  const soloKnowledge = items
    .filter((b) => b.risk.tier !== 'can-wait' && b.confidence === 'low')
    .map((b) => b.item.key);

  const coverMap = new Map<string, CoverLoad>();
  for (const b of items) {
    if (!b.standIn || b.risk.tier === 'can-wait') continue;
    const entry = coverMap.get(b.standIn.accountId) ?? {
      accountId: b.standIn.accountId,
      displayName: b.standIn.displayName,
      itemKeys: [],
    };
    entry.itemKeys.push(b.item.key);
    coverMap.set(b.standIn.accountId, entry);
  }
  const cover = [...coverMap.values()].sort((a, b) => b.itemKeys.length - a.itemKeys.length);

  const pullRequests = dedupePullRequests([...s.pullRequests, ...s.workItems.flatMap((w) => w.pullRequests)]);

  const count = (tier: Tier) => items.filter((b) => b.risk.tier === tier).length;
  const flagged = (flag: string) => items.filter((b) => b.risk.flags.includes(flag as never)).length;
  const stats: BriefStats = {
    open: Math.max(items.length, s.openTotal ?? 0),
    planned: items.length,
    must: count('must'),
    should: count('should'),
    canWait: count('can-wait'),
    dueWhileAway: flagged('due-while-away'),
    overdue: flagged('overdue'),
    openPullRequests: pullRequests.filter((p) => p.status === 'OPEN' || p.status === 'DRAFT').length,
    soloKnowledge: soloKnowledge.length,
    standIns: cover.length,
  };

  return {
    person: s.person,
    absence: s.absence,
    today: s.today,
    siteUrl: s.siteUrl,
    headline: headlineFor(s.person.displayName, s.absence, stats),
    stats,
    items,
    soloKnowledge,
    cover,
    pullRequests,
    goals: s.goals,
    pages: s.pages,
    sources: s.sources,
  };
}

export function headlineFor(name: string, absence: Absence, st: BriefStats): string {
  if (st.open === 0) return `${name} has no open Jira work assigned, so there is nothing to cover in Jira.`;
  const parts = [
    st.planned < st.open
      ? `${name} has ${plural(st.open, 'open item')} (this plan covers the ${st.planned} most urgent)`
      : `${name} has ${plural(st.open, 'open item')}`,
  ];
  const details: string[] = [];
  if (st.must > 0) details.push(`${st.must} must be covered from ${formatDay(absence.start)}`);
  if (st.dueWhileAway > 0) details.push(`${st.dueWhileAway} fall${st.dueWhileAway === 1 ? 's' : ''} due before ${formatDay(absence.end)}`);
  if (st.overdue > 0) details.push(`${st.overdue} already overdue`);
  if (st.soloKnowledge > 0) details.push(`${st.soloKnowledge} only ${name} has context on`);
  return details.length ? `${parts[0]}: ${details.join(', ')}.` : `${parts[0]}, none of them urgent.`;
}

/** Compact JSON for a Rovo agent or MCP client: small, flat and self-explaining. */
export function toAgentView(b: Brief) {
  const line = (x: BriefItem) => ({
    key: x.item.key,
    summary: x.item.summary,
    url: x.item.url,
    status: x.item.status,
    due: x.item.dueDate ?? null,
    priority: x.item.priority ?? null,
    whyItMatters: x.risk.flags.map((f) => RISK_LABELS[f]),
    suggestedStandIn: x.standIn ? { name: x.standIn.displayName, accountId: x.standIn.accountId } : null,
    because: x.standIn ? x.standIn.reasons.map((r) => r.text) : [],
    confidence: x.confidence,
    alternatives: x.alternatives.map((c) => c.displayName),
  });
  return {
    person: b.person.displayName,
    personAccountId: b.person.accountId,
    away: { from: b.absence.start, to: b.absence.end },
    headline: b.headline,
    stats: b.stats,
    coverPlan: b.items.filter((x) => x.risk.tier !== 'can-wait').slice(0, 20).map(line),
    canWait: b.items.filter((x) => x.risk.tier === 'can-wait').slice(0, 20).map((x) => ({ key: x.item.key, summary: x.item.summary })),
    onlyThisPersonHasContext: b.soloKnowledge,
    whoCoversWhat: b.cover.map((c) => ({ name: c.displayName, items: c.itemKeys })),
    pullRequestsInFlight: b.pullRequests
      .filter((p) => p.status === 'OPEN' || p.status === 'DRAFT')
      .slice(0, 10)
      .map((p) => ({ title: p.title, url: p.url ?? null, status: p.status, workItem: p.workItemKey ?? null })),
    goalsAndProjects: b.goals.slice(0, 10).map((g) => ({ name: g.name, kind: g.kind, state: g.state ?? null, url: g.url ?? null })),
    recentPages: b.pages.slice(0, 10).map((p) => ({ title: p.title, url: p.url })),
    dataSources: b.sources,
  };
}
