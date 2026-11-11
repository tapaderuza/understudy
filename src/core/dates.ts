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
 * Accepts loose input from a form or an agent and returns a valid absence.
 * Missing or invalid dates fall back to "from today, for one week"; an end
 * before the start is swapped rather than rejected.
 */
export function normaliseAbsence(start: unknown, end: unknown, today: string): Absence {
  const s = isIsoDay(start) ? start : today;
  const e = isIsoDay(end) ? end : addDays(s, 6);
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

/** "3 Dec 2026" style, fixed to English month names so output is deterministic. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDay(day: string): string {
  if (!isIsoDay(day)) return day;
  const [y, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
