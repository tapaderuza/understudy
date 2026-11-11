// Rovo actions. The same functions are exposed as MCP tools (rovo:mcp), so
// a customer's own agents and external MCP clients get the same answers.
//
// Inputs come from an LLM and may be wrong: identity always comes from the
// invocation context, and every Atlassian call runs as that user. Dates are
// checked first, so a wrong one is reported before any slow work.
import { RISK_LABELS } from './core/risk';
import { toAgentView } from './core/brief';
import { checkAbsenceInput, dayInput } from './core/dates';
import { toAgentReturnView } from './core/handback';
import { isIssueKey } from './adapters/parse';
import { toAgentTeamView } from './core/team';
import {
  briefAllStandIns,
  failure,
  notifyStandIn,
  overridesFrom,
  prepare,
  projectsOf,
  publish,
  requestWalkthrough,
  resolvePerson,
  standInsForItem,
  teamRisk,
  welcomeBack,
} from './service';

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

export async function getHandoverBrief(payload: Json, context: Json) {
  try {
    checkAbsenceInput(payload?.startDate, payload?.endDate);
    const requester = requesterOf(payload, context);
    const person = await resolvePerson(payload?.person, requester);
    const { brief } = await prepare({
      personId: person.accountId,
      person,
      start: payload?.startDate,
      end: payload?.endDate,
      cloudId: cloudOf(payload, context),
      requesterId: requester,
    });
    return toAgentView(brief);
  } catch (e) {
    return failure(e, 'get-handover-brief');
  }
}

export async function getWelcomeBackBrief(payload: Json, context: Json) {
  try {
    dayInput(payload?.since);
    const person = await resolvePerson(payload?.person, requesterOf(payload, context));
    return toAgentReturnView(await welcomeBack(person, payload?.since));
  } catch (e) {
    return failure(e, 'get-welcome-back-brief');
  }
}

export async function suggestStandIns(payload: Json, context: Json) {
  try {
    const key = issueKeyOf(payload);
    if (!key) throw new Error('Tell me which work item, for example PAY-101.');
    const r = await standInsForItem(key, cloudOf(payload, context), requesterOf(payload, context));
    if (r.unassigned) return { item: r.item, owner: null, whyItMatters: [], candidates: [], note: r.message };
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
    return failure(e, 'suggest-stand-ins');
  }
}

export async function publishHandoverPage(payload: Json, context: Json) {
  try {
    const spaceKey = typeof payload?.spaceKey === 'string' ? payload.spaceKey.trim() : '';
    if (!spaceKey) throw new Error('Which Confluence space should the handover page go in? Give its space key.');
    checkAbsenceInput(payload?.startDate, payload?.endDate);
    const requester = requesterOf(payload, context);
    const person = await resolvePerson(payload?.person, requester);
    const { brief } = await prepare({
      personId: person.accountId,
      person,
      start: payload?.startDate,
      end: payload?.endDate,
      cloudId: cloudOf(payload, context),
      overrides: await overridesFrom(payload?.standIns, requester),
      requesterId: requester,
    });
    const page = await publish(brief, { key: spaceKey });
    return { published: true, title: page.title, url: page.url, headline: brief.headline };
  } catch (e) {
    return failure(e, 'publish-handover-page');
  }
}

export async function briefStandIn(payload: Json, context: Json) {
  try {
    const key = issueKeyOf(payload);
    if (!key) throw new Error('Tell me which work item, for example PAY-101.');
    if (typeof payload?.standIn !== 'string' || !payload.standIn.trim()) throw new Error('Who is the stand-in?');
    checkAbsenceInput(payload?.startDate, payload?.endDate);
    const requester = requesterOf(payload, context);
    const standIn = await resolvePerson(payload.standIn, requester);
    return await notifyStandIn({
      issueKey: key,
      standIn,
      cloudId: cloudOf(payload, context),
      start: payload?.startDate,
      end: payload?.endDate,
      note: typeof payload?.note === 'string' ? payload.note : undefined,
      requesterId: requester,
    });
  } catch (e) {
    return failure(e, 'brief-stand-in');
  }
}

/** "PAY, OPS" or "pay ops" as project keys; anything that is not a key is dropped. */
function projectKeysOf(input: unknown): string[] {
  if (typeof input !== 'string') return [];
  return input
    .split(/[\s,;]+/)
    .map((k) => k.trim().toUpperCase())
    .filter((k) => /^[A-Z][A-Z0-9_]{0,49}$/.test(k));
}

export async function getTeamKnowledgeRisk(payload: Json, context: Json) {
  try {
    let keys = projectKeysOf(payload?.projects);
    if (keys.length === 0) {
      const requester = requesterOf(payload, context);
      keys = requester ? await projectsOf(requester) : [];
      if (keys.length === 0) throw new Error('Which Jira projects should I check? Give one or more project keys, for example PAY.');
    }
    return toAgentTeamView(await teamRisk(keys));
  } catch (e) {
    return failure(e, 'get-team-knowledge-risk');
  }
}

export async function requestWalkthroughAction(payload: Json, context: Json) {
  try {
    const key = issueKeyOf(payload);
    if (!key) throw new Error('Tell me which work item, for example PAY-101.');
    if (typeof payload?.learner !== 'string' || !payload.learner.trim()) throw new Error('Who should learn this work item?');
    const learner = await resolvePerson(payload.learner, requesterOf(payload, context));
    return await requestWalkthrough({ issueKey: key, learner, note: typeof payload?.note === 'string' ? payload.note : undefined });
  } catch (e) {
    return failure(e, 'request-walkthrough');
  }
}

export async function briefAllStandInsAction(payload: Json, context: Json) {
  try {
    checkAbsenceInput(payload?.startDate, payload?.endDate);
    const requester = requesterOf(payload, context);
    const person = await resolvePerson(payload?.person, requester);
    return await briefAllStandIns({
      personId: person.accountId,
      person,
      start: payload?.startDate,
      end: payload?.endDate,
      cloudId: cloudOf(payload, context),
      overrides: await overridesFrom(payload?.standIns, requester),
      note: typeof payload?.note === 'string' ? payload.note : undefined,
      requesterId: requester,
    });
  } catch (e) {
    return failure(e, 'brief-all-stand-ins');
  }
}
