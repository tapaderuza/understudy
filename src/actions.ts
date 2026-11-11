// Rovo actions. The same functions are exposed as MCP tools (rovo:mcp), so
// a customer's own agents and external MCP clients get the same answers.
//
// Inputs come from an LLM and may be wrong: identity always comes from the
// invocation context, and every Atlassian call runs as that user.
import { RISK_LABELS } from './core/risk';
import { toAgentView } from './core/brief';
import { toAgentReturnView } from './core/handback';
import { isIssueKey } from './adapters/parse';
import { notifyStandIn, prepare, publish, resolvePerson, standInsForItem, welcomeBack } from './service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

function requesterOf(payload: Json, context: Json): string | undefined {
  return context?.principal?.accountId ?? context?.accountId ?? payload?.context?.accountId;
}

function cloudOf(payload: Json, context: Json): string | undefined {
  return payload?.context?.cloudId ?? context?.cloudId ?? context?.installContext?.split('/')?.pop();
}

/** The issue key from the input, or from the work item the user is looking at. */
function issueKeyOf(payload: Json): string | undefined {
  const typed = typeof payload?.issueKey === 'string' ? payload.issueKey.trim().toUpperCase() : '';
  if (isIssueKey(typed)) return typed;
  const fromPage = payload?.context?.jira?.issueKey;
  return typeof fromPage === 'string' && isIssueKey(fromPage) ? fromPage : undefined;
}

const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });

export async function getHandoverBrief(payload: Json, context: Json) {
  try {
    const requester = requesterOf(payload, context);
    const person = await resolvePerson(payload?.person, requester);
    const { brief } = await prepare({
      personId: person.accountId,
      person,
      start: payload?.startDate,
      end: payload?.endDate,
      cloudId: cloudOf(payload, context),
    });
    return toAgentView(brief);
  } catch (e) {
    return fail(e);
  }
}

export async function getWelcomeBackBrief(payload: Json, context: Json) {
  try {
    const person = await resolvePerson(payload?.person, requesterOf(payload, context));
    return toAgentReturnView(await welcomeBack(person, payload?.since));
  } catch (e) {
    return fail(e);
  }
}

export async function suggestStandIns(payload: Json, context: Json) {
  try {
    const key = issueKeyOf(payload);
    if (!key) throw new Error('Tell me which work item, for example PAY-101.');
    const r = await standInsForItem(key, requesterOf(payload, context), cloudOf(payload, context));
    const entry = r.brief.items.find((b) => b.item.key === key);
    return {
      item: r.item,
      owner: r.owner.displayName,
      whyItMatters: entry ? entry.risk.flags.map((f) => RISK_LABELS[f]) : [],
      candidates: r.candidates.map((c) => ({
        name: c.displayName,
        accountId: c.accountId,
        score: c.score,
        openItems: c.load,
        because: c.reasons.map((x) => x.text),
      })),
      note: r.candidates.length ? undefined : `Nobody else has recorded context on ${key}. Suggest a walkthrough before ${r.owner.displayName} leaves.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function publishHandoverPage(payload: Json, context: Json) {
  try {
    const spaceKey = typeof payload?.spaceKey === 'string' ? payload.spaceKey.trim() : '';
    if (!spaceKey) throw new Error('Which Confluence space should the handover page go in? Give its space key.');
    const person = await resolvePerson(payload?.person, requesterOf(payload, context));
    const { brief } = await prepare({
      personId: person.accountId,
      person,
      start: payload?.startDate,
      end: payload?.endDate,
      cloudId: cloudOf(payload, context),
    });
    const page = await publish(brief, { key: spaceKey });
    return { published: true, title: page.title, url: page.url, headline: brief.headline };
  } catch (e) {
    return fail(e);
  }
}

export async function briefStandIn(payload: Json, context: Json) {
  try {
    const key = issueKeyOf(payload);
    if (!key) throw new Error('Tell me which work item, for example PAY-101.');
    if (typeof payload?.standIn !== 'string' || !payload.standIn.trim()) throw new Error('Who is the stand-in?');
    const requester = requesterOf(payload, context);
    const standIn = await resolvePerson(payload.standIn, requester);
    return await notifyStandIn({
      issueKey: key,
      standIn,
      requesterId: requester,
      cloudId: cloudOf(payload, context),
      start: payload?.startDate,
      end: payload?.endDate,
      note: typeof payload?.note === 'string' ? payload.note : undefined,
    });
  } catch (e) {
    return fail(e);
  }
}
