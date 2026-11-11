// Backend for the Jira page. Every resolver returns { error } instead of
// throwing, so the page can show a readable message.
import Resolver from '@forge/resolver';
import type { Brief } from './core/brief';
import { RISK_LABELS } from './core/risk';
import { getMyself, getPerson } from './adapters/atlassian';
import { isAccountId } from './adapters/parse';
import { confidenceOf } from './core/standins';
import { RETURN_LABELS } from './core/handback';
import { listSpaces, notifyStandIn, prepare, publish, standInsForItem, welcomeBack } from './service';

const resolver = new Resolver();

const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });

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
      standIn: x.standIn ? { accountId: x.standIn.accountId, displayName: x.standIn.displayName, reasons: x.standIn.reasons } : null,
      alternatives: x.alternatives.map((c) => ({ accountId: c.accountId, displayName: c.displayName })),
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
    return fail(e);
  }
});

resolver.define('buildBrief', async ({ payload, context }) => {
  try {
    const p = (payload ?? {}) as BriefPayload;
    const personId = isAccountId(p.accountId) ? p.accountId : context.accountId;
    const { brief } = await prepare({ personId, start: p.start, end: p.end, cloudId: context.cloudId, overrides: p.overrides });
    return forUi(brief);
  } catch (e) {
    return fail(e);
  }
});

resolver.define('listSpaces', async () => {
  try {
    return { spaces: await listSpaces() };
  } catch (e) {
    return fail(e);
  }
});

resolver.define('publish', async ({ payload, context }) => {
  try {
    const p = (payload ?? {}) as BriefPayload & { spaceId?: string };
    const personId = isAccountId(p.accountId) ? p.accountId : context.accountId;
    const { brief } = await prepare({ personId, start: p.start, end: p.end, cloudId: context.cloudId, overrides: p.overrides });
    return await publish(brief, { id: p.spaceId });
  } catch (e) {
    return fail(e);
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
      requesterId: context.accountId,
      cloudId: context.cloudId,
      start: p.start,
      end: p.end,
      note: p.note,
    });
  } catch (e) {
    return fail(e);
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
    return fail(e);
  }
});

/** The issue panel: who could cover the work item being viewed, and why. */
resolver.define('issueStandIns', async ({ context }) => {
  try {
    const key = context?.extension?.issue?.key;
    if (typeof key !== 'string') throw new Error('Open a work item to see who could cover it.');
    const r = await standInsForItem(key, context.accountId, context.cloudId);
    const entry = r.brief.items.find((b) => b.item.key === key);
    return {
      item: r.item,
      owner: r.owner,
      whyItMatters: entry ? entry.risk.flags.map((f) => RISK_LABELS[f]) : [],
      tier: entry?.risk.tier ?? null,
      confidence: confidenceOf(r.candidates[0]),
      candidates: r.candidates.map((c) => ({ accountId: c.accountId, displayName: c.displayName, score: c.score, load: c.load, reasons: c.reasons })),
    };
  } catch (e) {
    return fail(e);
  }
});

export type IssuePanelData = {
  item: { key: string; summary: string; url: string };
  owner: { accountId: string; displayName: string };
  whyItMatters: string[];
  tier: 'must' | 'should' | 'can-wait' | null;
  confidence: 'high' | 'medium' | 'low';
  candidates: { accountId: string; displayName: string; score: number; load: number; reasons: { text: string; points: number }[] }[];
};

type WelcomeBackResult = Awaited<ReturnType<typeof welcomeBack>>;
export type UiWelcomeBack = Omit<WelcomeBackResult, 'items'> & {
  items: (WelcomeBackResult['items'][number] & { labels: string[] })[];
};

export const handler = resolver.getDefinitions();
