// Understudy acting on its own: when someone creates or updates a work item
// that announces time off, it drafts the handover and posts it on that item
// as a comment for the person going away. It only reads and comments; stand-
// ins are briefed after the person reviews the plan.
import { asTheApp } from './adapters/actor';
import { addComment, deleteComment, fieldIdByName, getLeaveIssueRaw } from './adapters/atlassian';
import { isIssueKey, parseLeaveItem } from './adapters/parse';
import { addDays, todayIn } from './core/dates';
import { userMessage } from './core/errors';
import { draftHandoverComment } from './core/render';
import { prepare } from './service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

/** Days away when the time-off item has no due date. */
const DEFAULT_DAYS_AWAY = 5;

/** The "Start date" field's ID, looked up once per container. */
let startFieldId: string | null | undefined;

/** Changes to a work item that can turn it into a time-off item, or change who or when. */
const RELEVANT_FIELDS = new Set(['labels', 'issuetype', 'summary', 'duedate', 'reporter', 'start date']);

/**
 * True for a created item, or an update that touched a field that matters.
 * Other updates (comments, status, watchers) are ignored, which keeps the
 * trigger quiet and makes two drafts racing each other much less likely.
 */
export function isRelevantEvent(event: Json): boolean {
  if (event?.eventType !== 'avi:jira:updated:issue') return true;
  const items = event?.changelog?.items;
  if (!Array.isArray(items)) return true;
  return items.some((i: Json) => RELEVANT_FIELDS.has(String(i?.field ?? '').toLowerCase()));
}

/** Of two drafts posted at the same time, the later one gives way. */
export function shouldWithdraw(myId: string | undefined, draftIds: string[]): boolean {
  return Boolean(myId) && draftIds.some((id) => Number(id) < Number(myId));
}

/** The first and last day away, from the item or sensible defaults. */
export function leaveDates(start: string | undefined, end: string | undefined, today: string): { start: string; end: string } {
  const first = start && start >= today ? start : addDays(today, 1);
  const last = end && end >= first ? end : addDays(first, DEFAULT_DAYS_AWAY - 1);
  return { start: first, end: last };
}

export async function onLeaveItem(event: Json): Promise<void> {
  const key = event?.issue?.key;
  if (!isIssueKey(key) || !isRelevantEvent(event)) return;
  try {
    await asTheApp(async () => {
      if (startFieldId === undefined) startFieldId = (await fieldIdByName('Start date').catch(() => undefined)) ?? null;
      const leave = parseLeaveItem(await getLeaveIssueRaw(key, startFieldId ? [startFieldId] : []), startFieldId ?? undefined);
      if (!leave || leave.drafted) return;
      const today = todayIn(undefined);
      const { start, end } = leaveDates(leave.start, leave.end, today);
      const { brief } = await prepare({
        personId: leave.leaver.accountId,
        person: leave.leaver,
        start,
        end,
        today,
        excludeKeys: [leave.key],
      });
      const myId = await addComment(leave.key, draftHandoverComment(brief));
      const after = parseLeaveItem(await getLeaveIssueRaw(key, startFieldId ? [startFieldId] : []), startFieldId ?? undefined);
      if (after && myId && shouldWithdraw(myId, after.draftIds)) {
        await deleteComment(leave.key, myId);
        console.info('[understudy] a draft for this time-off item was already posted, so this one was withdrawn');
        return;
      }
      console.info(
        '[understudy] drafted a handover on a time-off item',
        JSON.stringify({ open: brief.stats.open, must: brief.stats.must, solo: brief.stats.soloKnowledge, standIns: brief.stats.standIns }),
      );
    });
  } catch (e) {
    console.error('[understudy] time-off trigger failed', userMessage(e));
  }
}
