// Backend for the Jira page. Every resolver returns { error } instead of
// throwing, so the page can show a readable message (never a raw API answer).
import Resolver from '@forge/resolver';
import type { Brief } from './core/brief';
import { RISK_LABELS } from './core/risk';
import { getMyself, getPerson } from './adapters/atlassian';
import { isAccountId } from './adapters/parse';
import { confidenceOf, contextPointsOf } from './core/standins';
import { RETURN_LABELS } from './core/handback';
import { addDays } from './core/dates';
import { TEAM_RISK_LABELS, evidenceOf, type TeamRisk } from './core/team';
import {
  failure,
  listProjects,
  listSpaces,
  notifyStandIn,
  prepare,
  projectsOf,
  publish,
  requestWalkthrough,
  standInsForItem,
  teamRisk,
  welcomeBack,
} from './service';

const resolver = new Resolver();

/** What the page needs, without comment histories and other bulk. */
function forUi(b: Brief) {
  return {
    person: b.person,
    absence: b.absence,
    today: b.today,
    headline: b.headline,
    stats: b.stats,
    soloKnowledge: b.soloKnowledge,
    cover: b.cover,
    items: b.items.map((x) => ({
      key: x.item.key,
      summary: x.item.summary,
      url: x.item.url,
      status: x.item.status,
      statusCategory: x.item.statusCategory,
      priority: x.item.priority ?? null,
      dueDate: x.item.dueDate ?? null,
      tier: x.risk.tier,
      flags: x.risk.flags.map((f) =>
        f === 'blocked' && x.item.blockedBy?.length ? `Blocked by ${x.item.blockedBy.slice(0, 2).join(', ')}` : RISK_LABELS[f],
      ),
      confidence: x.confidence,
      chosenByHand: x.chosenByHand,
      standIn: x.standIn
        ? { accountId: x.standIn.accountId, displayName: x.standIn.displayName, reasons: x.standIn.reasons, contextPoints: contextPointsOf(x.standIn) }
        : null,
      alternatives: x.alternatives.map((c) => ({ accountId: c.accountId, displayName: c.displayName, contextPoints: contextPointsOf(c) })),
    })),
    pullRequests: b.pullRequests.slice(0, 25),
    goals: b.goals.slice(0, 25),
    pages: b.pages.slice(0, 15),
    sources: b.sources,
  };
}

export type UiBrief = ReturnType<typeof forUi>;

interface BriefPayload {
  accountId?: string;
  start?: string;
  end?: string;
  overrides?: Record<string, string>;
}

resolver.define('whoAmI', async () => {
  try {
    return await getMyself();
  } catch (e) {
    return failure(e, 'whoAmI');
  }
});

resolver.define('buildBrief', async ({ payload, context }) => {
  try {
    const p = (payload ?? {}) as BriefPayload;
    const personId = isAccountId(p.accountId) ? p.accountId : context.accountId;
    const { brief } = await prepare({
      personId,
      start: p.start,
      end: p.end,
      cloudId: context.cloudId,
      overrides: p.overrides,
      requesterId: context.accountId,
    });
    return forUi(brief);
  } catch (e) {
    return failure(e, 'buildBrief');
  }
});

resolver.define('listSpaces', async () => {
  try {
    return { spaces: await listSpaces() };
  } catch (e) {
    return failure(e, 'listSpaces');
  }
});

resolver.define('publish', async ({ payload, context }) => {
  try {
    const p = (payload ?? {}) as BriefPayload & { spaceId?: string };
    const personId = isAccountId(p.accountId) ? p.accountId : context.accountId;
    const { brief } = await prepare({
      personId,
      start: p.start,
      end: p.end,
      cloudId: context.cloudId,
      overrides: p.overrides,
      requesterId: context.accountId,
    });
    return await publish(brief, { id: p.spaceId });
  } catch (e) {
    return failure(e, 'publish');
  }
});

resolver.define('notify', async ({ payload, context }) => {
  try {
    const p = (payload ?? {}) as { issueKey?: string; standInId?: string; start?: string; end?: string; note?: string };
    if (!isAccountId(p.standInId)) throw new Error('Pick a stand-in first.');
    const standIn = await getPerson(p.standInId);
    return await notifyStandIn({
      issueKey: String(p.issueKey ?? ''),
      standIn,
      cloudId: context.cloudId,
      start: p.start,
      end: p.end,
      note: p.note,
      requesterId: context.accountId,
    });
  } catch (e) {
    return failure(e, 'notify');
  }
});

resolver.define('welcomeBack', async ({ payload, context }) => {
  try {
    const p = (payload ?? {}) as { accountId?: string; since?: string };
    const person = await getPerson(isAccountId(p.accountId) ? p.accountId : context.accountId);
    const w = await welcomeBack(person, p.since);
    return {
      ...w,
      items: w.items.map((i) => ({ ...i, labels: i.reasons.map((r) => RETURN_LABELS[r]), events: i.events.slice(-3) })),
    };
  } catch (e) {
    return failure(e, 'welcomeBack');
  }
});

/** The issue panel: who could cover the work item being viewed, and why. */
resolver.define('issueStandIns', async ({ context }) => {
  try {
    const key = context?.extension?.issue?.key;
    if (typeof key !== 'string') throw new Error('Open a work item to see who could cover it.');
    const r = await standInsForItem(key, context.cloudId, context.accountId);
    if (r.unassigned) {
      const none: IssuePanelData = {
        item: r.item,
        owner: { accountId: '', displayName: 'Unassigned' },
        whyItMatters: [],
        tier: null,
        confidence: 'low',
        candidates: [],
        unassigned: true,
        notice: r.message,
        notes: [],
      };
      return none;
    }
    const entry = r.brief.items.find((b) => b.item.key === r.item.key);
    const data: IssuePanelData = {
      item: r.item,
      owner: r.owner,
      whyItMatters: entry ? entry.risk.flags.map((f) => RISK_LABELS[f]) : [],
      tier: entry?.risk.tier ?? null,
      confidence: confidenceOf(r.candidates[0]),
      candidates: r.candidates.map((c) => ({
        accountId: c.accountId,
        displayName: c.displayName,
        score: c.score,
        load: c.load,
        contextPoints: contextPointsOf(c),
        reasons: c.reasons,
      })),
      unassigned: false,
      notice: null,
      notes: r.brief.sources.notes,
    };
    return data;
  } catch (e) {
    return failure(e, 'issueStandIns');
  }
});

export type IssuePanelData = {
  item: { key: string; summary: string; url: string };
  owner: { accountId: string; displayName: string };
  whyItMatters: string[];
  tier: 'must' | 'should' | 'can-wait' | null;
  confidence: 'high' | 'medium' | 'low';
  candidates: {
    accountId: string;
    displayName: string;
    score: number;
    load: number;
    /** Sum of the positive reason points (evidence only, no load penalty), for an evidence bar. */
    contextPoints: number;
    reasons: { text: string; points: number }[];
  }[];
  /** True when the work item has no assignee: show `notice` instead of the question and candidates. */
  unassigned: boolean;
  /** A message to show instead of candidates (for now only the "no assignee" one), else null. */
  notice: string | null;
  /** Sources left out because they failed or were slow, in plain words. Empty when everything answered. */
  notes: string[];
};

/** The team view without comment histories: small enough for the page. */
function teamForUi(t: TeamRisk) {
  return {
    projects: t.projects,
    today: t.today,
    window: t.window,
    headline: t.headline,
    stats: t.stats,
    people: t.people.slice(0, 30).map((p) => ({
      person: p.person,
      open: p.open,
      solo: p.solo,
      soloUrgent: p.soloUrgent,
      readiness: p.readiness,
      backup: p.backup ?? null,
    })),
    atRisk: t.atRisk.slice(0, 50).map((x) => ({
      key: x.item.key,
      summary: x.item.summary,
      url: x.item.url,
      status: x.item.status,
      dueDate: x.item.dueDate ?? null,
      tier: x.risk.tier,
      flags: x.risk.flags.map((f) => TEAM_RISK_LABELS[f]),
      owner: x.owner,
      closest: x.closest
        ? { accountId: x.closest.accountId, displayName: x.closest.displayName, reasons: evidenceOf(x.closest), contextPoints: contextPointsOf(x.closest) }
        : null,
      walkthrough: x.item.walkthrough && x.item.walkthrough.at.slice(0, 10) >= addDays(t.today, -14) ? x.item.walkthrough : null,
    })),
    notes: t.notes,
  };
}

export type UiTeamRisk = ReturnType<typeof teamForUi>;

resolver.define('listProjects', async ({ context }) => {
  try {
    const [projects, mine] = await Promise.all([listProjects(), projectsOf(context.accountId).catch(() => [] as string[])]);
    return { projects, suggested: mine };
  } catch (e) {
    return failure(e, 'listProjects');
  }
});

resolver.define('teamRisk', async ({ payload }) => {
  try {
    const p = (payload ?? {}) as { projects?: unknown };
    const keys = Array.isArray(p.projects) ? p.projects.filter((x): x is string => typeof x === 'string') : [];
    return teamForUi(await teamRisk(keys));
  } catch (e) {
    return failure(e, 'teamRisk');
  }
});

resolver.define('walkthrough', async ({ payload }) => {
  try {
    const p = (payload ?? {}) as { issueKey?: string; learnerId?: string; note?: string };
    if (!isAccountId(p.learnerId)) throw new Error('Pick who should learn this work item first.');
    const learner = await getPerson(p.learnerId);
    return await requestWalkthrough({ issueKey: String(p.issueKey ?? ''), learner, note: p.note });
  } catch (e) {
    return failure(e, 'walkthrough');
  }
});

type WelcomeBackResult = Awaited<ReturnType<typeof welcomeBack>>;
export type UiWelcomeBack = Omit<WelcomeBackResult, 'items'> & {
  items: (WelcomeBackResult['items'][number] & { labels: string[] })[];
};

export const handler = resolver.getDefinitions();
