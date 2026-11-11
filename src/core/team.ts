// Team knowledge risk: before anyone goes away, which open work only one
// person understands, and who is best placed to learn it. Pure, like the rest
// of src/core: the same stand-in evidence as a handover, applied to a whole
// project at once.
import { addDays, formatDay } from './dates';
import { RISK_LABELS, assessRisk, type RiskAssessment, type RiskFlag, type Tier } from './risk';
import { confidenceOf, rankStandIns, type Candidate, type Confidence, type Reason } from './standins';
import type { Absence, PeerWork, Person, WorkItem } from './types';

/** An open work item and the person it is assigned to. */
export interface OwnedItem {
  item: WorkItem;
  owner: Person;
}

/** Everything the team view needs, read from Jira for one or more projects. */
export interface TeamSnapshot {
  projects: string[];
  /** YYYY-MM-DD */
  today: string;
  items: OwnedItem[];
  /** Recently updated work in the same projects: who has worked where. */
  peerWork: PeerWork[];
  /** Open items per person across Jira, when it could be read. */
  openLoad: Record<string, number>;
  /** Every open assigned item in scope, when there were more than could be read. */
  openTotal?: number;
  notes: string[];
}

/** "Matters soon" looks two weeks ahead, the length of a typical holiday. */
export const TEAM_WINDOW_DAYS = 14;

/** Labels for the team view, where nobody has dates away yet. */
export const TEAM_RISK_LABELS: Record<RiskFlag, string> = {
  ...RISK_LABELS,
  'due-while-away': 'Due in the next 2 weeks',
};

export interface TeamItem {
  item: WorkItem;
  owner: Person;
  risk: RiskAssessment;
  confidence: Confidence;
  /** The colleague with the most context on it, even when that is little. */
  closest?: Candidate;
}

export interface Backup {
  accountId: string;
  displayName: string;
  /** How many of this person's items they could pick up today. */
  couldCover: number;
  /** Evidence points summed over this person's items. */
  points: number;
}

export interface TeamPerson {
  person: Person;
  open: number;
  /** Keys of items nobody else has enough context to pick up. */
  solo: string[];
  /** Of those, the ones that matter in the next two weeks. */
  soloUrgent: string[];
  /** Share of their items someone else could pick up today, 0 to 100. */
  readiness: number;
  /** The colleague best placed to cover for them across their work. */
  backup?: Backup;
}

export interface TeamStats {
  /** Every open assigned item in scope. */
  open: number;
  /** Items read and assessed. */
  checked: number;
  people: number;
  solo: number;
  soloUrgent: number;
  /** Share of checked items someone else could pick up today, 0 to 100. */
  readiness: number;
}

export interface TeamRisk {
  projects: string[];
  today: string;
  window: Absence;
  headline: string;
  stats: TeamStats;
  /** Most knowledge at risk first. */
  people: TeamPerson[];
  /** Items only their owner knows, most urgent first. */
  atRisk: TeamItem[];
  notes: string[];
}

const TIER_ORDER: Record<Tier, number> = { must: 0, should: 1, 'can-wait': 2 };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 100);

function byUrgency(a: TeamItem, b: TeamItem): number {
  return (
    TIER_ORDER[a.risk.tier] - TIER_ORDER[b.risk.tier] ||
    b.risk.score - a.risk.score ||
    (a.item.dueDate ?? '9999').localeCompare(b.item.dueDate ?? '9999') ||
    a.item.key.localeCompare(b.item.key, undefined, { numeric: true })
  );
}

/** Someone else could pick it up today: the best stand-in has some real context. */
const coverable = (t: TeamItem) => t.confidence !== 'low';

/**
 * Finds the work only one person understands. Each item is scored exactly as
 * in a handover (same evidence, same thresholds), as if its owner left today
 * for two weeks. Nothing is assigned here, so the plan's load spreading does
 * not apply: "closest" is about who knows the work, not who is free.
 */
export function buildTeamRisk(s: TeamSnapshot): TeamRisk {
  const window: Absence = { start: s.today, end: addDays(s.today, TEAM_WINDOW_DAYS - 1) };

  const assessed: TeamItem[] = [];
  const evidence = new Map<string, Map<string, Backup>>();
  for (const { item, owner } of s.items) {
    if (item.statusCategory === 'done') continue;
    const ranked = rankStandIns(
      item,
      { personId: owner.accountId, teammates: [], peerWork: s.peerWork, openLoad: s.openLoad },
      {},
      50,
    );
    const best = ranked[0];
    assessed.push({
      item,
      owner,
      risk: assessRisk(item, owner.accountId, window, s.today),
      confidence: confidenceOf(best),
      closest: best,
    });
    const mine = evidence.get(owner.accountId) ?? new Map<string, Backup>();
    for (const c of ranked) {
      const b = mine.get(c.accountId) ?? { accountId: c.accountId, displayName: c.displayName, couldCover: 0, points: 0 };
      b.points += c.context;
      if (confidenceOf(c) !== 'low') b.couldCover += 1;
      mine.set(c.accountId, b);
    }
    evidence.set(owner.accountId, mine);
  }

  const owners = new Map<string, Person>();
  for (const t of assessed) owners.set(t.owner.accountId, t.owner);

  const people: TeamPerson[] = [...owners.values()].map((person) => {
    const theirs = assessed.filter((t) => t.owner.accountId === person.accountId).sort(byUrgency);
    const solo = theirs.filter((t) => !coverable(t));
    const backups = [...(evidence.get(person.accountId)?.values() ?? [])].sort(
      (a, b) => b.couldCover - a.couldCover || b.points - a.points || a.displayName.localeCompare(b.displayName),
    );
    return {
      person,
      open: theirs.length,
      solo: solo.map((t) => t.item.key),
      soloUrgent: solo.filter((t) => t.risk.tier !== 'can-wait').map((t) => t.item.key),
      readiness: percent(theirs.length - solo.length, theirs.length),
      backup: backups[0] && backups[0].points > 0 ? backups[0] : undefined,
    };
  });
  people.sort(
    (a, b) =>
      b.soloUrgent.length - a.soloUrgent.length ||
      b.solo.length - a.solo.length ||
      b.open - a.open ||
      a.person.displayName.localeCompare(b.person.displayName),
  );

  const atRisk = assessed.filter((t) => !coverable(t)).sort(byUrgency);
  const stats: TeamStats = {
    open: Math.max(assessed.length, s.openTotal ?? 0),
    checked: assessed.length,
    people: people.length,
    solo: atRisk.length,
    soloUrgent: atRisk.filter((t) => t.risk.tier !== 'can-wait').length,
    readiness: percent(assessed.length - atRisk.length, assessed.length),
  };

  return {
    projects: s.projects,
    today: s.today,
    window,
    headline: teamHeadline(s.projects, stats, people[0]),
    stats,
    people,
    atRisk,
    notes: s.notes,
  };
}

export function teamHeadline(projects: string[], st: TeamStats, top: TeamPerson | undefined): string {
  const where = projects.length ? projects.join(', ') : 'these projects';
  if (st.checked === 0) return `Nobody has open assigned work in ${where}, so no knowledge is at risk there.`;
  if (st.solo === 0) return `Every open item in ${where} has someone else with context on it: cover readiness is 100%.`;
  const checked = st.checked < st.open ? `${st.checked} most urgent open items` : plural(st.open, 'open item');
  const urgent = st.soloUrgent > 0 ? `, ${st.soloUrgent} of them due or urgent in the next two weeks` : '';
  const who =
    top && top.solo.length > 0 ? ` ${top.person.displayName} holds the most: ${top.solo.length} of ${plural(top.open, 'item')}.` : '';
  return `Only one person has context on ${st.solo} of the ${checked} in ${where}${urgent}.${who}`;
}

/** Positive evidence only, for "why this colleague" lines. */
export const evidenceOf = (c: Candidate | undefined): Reason[] => (c?.reasons ?? []).filter((r) => r.points > 0);

/** Compact JSON for a Rovo agent or MCP client. */
export function toAgentTeamView(t: TeamRisk) {
  return {
    projects: t.projects,
    headline: t.headline,
    coverReadinessPercent: t.stats.readiness,
    stats: t.stats,
    lookingAhead: { from: t.window.start, to: t.window.end },
    people: t.people.slice(0, 20).map((p) => ({
      name: p.person.displayName,
      accountId: p.person.accountId,
      openItems: p.open,
      onlyTheyKnow: p.solo,
      urgentOnlyTheyKnow: p.soloUrgent,
      coverReadinessPercent: p.readiness,
      bestBackup: p.backup ? { name: p.backup.displayName, accountId: p.backup.accountId, couldCover: p.backup.couldCover } : null,
    })),
    knowledgeAtRisk: t.atRisk.slice(0, 20).map((x) => ({
      key: x.item.key,
      summary: x.item.summary,
      url: x.item.url,
      owner: x.owner.displayName,
      ownerAccountId: x.owner.accountId,
      due: x.item.dueDate ?? null,
      whyItMatters: x.risk.flags.map((f) => TEAM_RISK_LABELS[f]),
      closestColleague: x.closest ? { name: x.closest.displayName, accountId: x.closest.accountId } : null,
      closestColleagueEvidence: evidenceOf(x.closest).map((r) => r.text),
    })),
    advice:
      "For each item only one person knows, book a 15-minute walkthrough with the closest colleague (or the owner's best backup) before anyone goes away.",
    notes: t.notes,
  };
}

/** The two weeks the view looks ahead, such as "12 Nov 2026 to 25 Nov 2026". */
export const windowText = (w: Absence) => `${formatDay(w.start)} to ${formatDay(w.end)}`;
