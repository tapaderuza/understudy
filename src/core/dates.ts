import type { Absence } from './types';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Today's date where the person is, for an IANA time zone such as
 * "Europe/Madrid" (their Jira profile setting). UTC when the zone is missing
 * or unknown.
 */
export function todayIn(timeZone: string | undefined, now: Date = new Date()): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
      const part = (type: string) => parts.find((p) => p.type === type)?.value;
      const day = `${part('year')}-${part('month')}-${part('day')}`;
      if (isIsoDay(day)) return day;
    } catch {
      // Unknown zone: fall back to UTC.
    }
  }
  return toIsoDay(now);
}

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDay(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * One date typed by a person or an agent: undefined when none was given, the
 * day when it is a real YYYY-MM-DD date, and an error for anything else, so a
 * wrong date is never silently replaced by a default.
 */
export function dayInput(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = (typeof value === 'string' ? value : String(value)).trim();
  if (!text) return undefined;
  const shown = text.slice(0, 40);
  if (isIsoDay(text)) return text;
  throw new Error(`Use dates as YYYY-MM-DD (got '${shown}').`);
}

/** The checks that need no "today", so callers can reject bad dates before any slow work. */
export function checkAbsenceInput(start: unknown, end: unknown): { start?: string; end?: string } {
  const s = dayInput(start);
  const e = dayInput(end);
  if (s && e && e < s) throw new Error(`The last day away (${e}) is before the first day away (${s}).`);
  return { start: s, end: e };
}

/**
 * Reads an absence from a form or an agent. Missing dates mean "from today,
 * for one week"; a date that is not YYYY-MM-DD, or an end before the start,
 * is an error rather than a guess.
 */
export function normaliseAbsence(start: unknown, end: unknown, today: string): Absence {
  const given = checkAbsenceInput(start, end);
  const s = given.start ?? today;
  const e = given.end ?? addDays(s, 6);
  if (e < s) throw new Error(`The last day away (${e}) is before today (${today}). Give the first day away as well.`);
  return { start: s, end: e };
}

/** How far back a welcome back looks when nobody says when the absence began. */
export const DEFAULT_RETURN_DAYS = 14;

/** The first day away for a welcome back: two weeks ago by default, and never in the future. */
export function returnSince(since: unknown, today: string): string {
  const s = dayInput(since);
  if (!s) return addDays(today, -DEFAULT_RETURN_DAYS);
  if (s > today) {
    throw new Error(`The first day away (${s}) is in the future. Welcome back shows what already changed, so pick a day up to today (${today}).`);
  }
  return s;
}

/** "3 Dec 2026" style, fixed to English month names so output is deterministic. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDay(day: string): string {
  if (!isIsoDay(day)) return day;
  const [y, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
