// Understudy acting on its own: when someone creates or updates a work item
// that announces time off, it drafts the handover and posts it on that item
// as a comment for the person going away. It only reads and comments; stand-
// ins are briefed after the person reviews the plan.
import { asTheApp } from './adapters/actor';
import { addComment, fieldIdByName, getLeaveIssueRaw } from './adapters/atlassian';
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

/** The first and last day away, from the item or sensible defaults. */
export function leaveDates(start: string | undefined, end: string | undefined, today: string): { start: string; end: string } {
  const first = start && start >= today ? start : addDays(today, 1);
  const last = end && end >= first ? end : addDays(first, DEFAULT_DAYS_AWAY - 1);
  return { start: first, end: last };
}

export async function onLeaveItem(event: Json): Promise<void> {
  const key = event?.issue?.key;
  if (!isIssueKey(key)) return;
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
      await addComment(leave.key, draftHandoverComment(brief));
      console.info(
        '[understudy] drafted a handover on a time-off item',
        JSON.stringify({ open: brief.stats.open, must: brief.stats.must, solo: brief.stats.soloKnowledge, standIns: brief.stats.standIns }),
      );
    });
  } catch (e) {
    console.error('[understudy] time-off trigger failed', userMessage(e));
  }
}
