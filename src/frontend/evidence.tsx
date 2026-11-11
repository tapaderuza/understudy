// Shared by the Jira page and the issue panel: turns a stand-in's reasons
// into a short evidence bar and chips, with the full sentences on demand.
import React from 'react';
import { Inline, ProgressBar, Stack, Tag, TagGroup, Text } from '@forge/react';

export type Reason = { text: string; points: number };

/** Points of evidence at which the bar is full. */
const FULL = 12;

/** "+3", "−2", "−1.5": a sign is always shown, so colour never carries meaning alone. */
export const signed = (p: number): string => {
  const n = Math.round(Math.abs(p) * 10) / 10;
  return p < 0 ? `−${n}` : `+${n}`;
};

export const plainNumber = (p: number): string => String(Math.round(p * 10) / 10);

/** Context points: the candidate's own field when present, else the sum of positive reasons. */
export function contextPoints(c: { reasons: Reason[] }): number {
  const own = (c as unknown as Record<string, unknown>).contextPoints;
  if (typeof own === 'number' && Number.isFinite(own)) return own;
  return c.reasons.reduce((sum, r) => sum + (r.points > 0 ? r.points : 0), 0);
}

const clip = (s: string, max = 22): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const num = (s: string): string | undefined => /(\d+)/.exec(s)?.[1];

/**
 * A chip-sized label for one reason. Covers the wording in src/core/standins.ts,
 * old and new ("2 recent items in PAY" and "Has 2 recent items in PAY",
 * "Same team" and "In the same team", "Already carries 9 open items" and
 * "Busy: 9 open"); anything else is clipped.
 */
export function short(r: Reason): string {
  const t = r.text.trim();
  let m: RegExpExecArray | null;
  if (r.points < 0 || /^(already carries|busy)\b/i.test(t)) {
    const n = num(t);
    return n ? `Busy: ${n} open` : 'Busy';
  }
  if (/^(has )?commented\b/i.test(t)) {
    // "Commented 2 times on PAY-1" or "Commented on PAY-1 2 times": count the "N time(s)" part.
    m = /(\d+)\s+times?/i.exec(t);
    return m ? `Commented ×${m[1]}` : 'Commented';
  }
  if (/^(reported|reporter)\b/i.test(t)) return 'Reporter';
  if ((m = /(\d+)\s+recent items?\s+in\s+([A-Z][A-Z0-9_]*)/i.exec(t))) return `Recent in ${m[2]} ×${m[1]}`;
  if (/^(has )?worked on\b/i.test(t) || /same (epic|parent)/i.test(t)) {
    m = /(\d+)\s+(other )?items?/i.exec(t);
    return m ? `Same epic ×${m[1]}` : 'Same epic';
  }
  if ((m = /^knows the (.+?) components?$/i.exec(t))) {
    const list = m[1] ?? '';
    const count = list.split(',').length;
    return count > 1 ? `${count} components` : clip(`${list} component`);
  }
  if ((m = /labell?ed (.+)$/i.exec(t))) return clip(`Label ${m[1]}`);
  if (/^(in the )?same team/i.test(t)) return 'Same team';
  if (/^chosen by hand/i.test(t)) return 'Chosen by hand';
  return clip(t);
}

type TagColor = 'red' | 'green' | 'standard';
const chipColor = (p: number): TagColor => (p < 0 ? 'red' : p >= 3 ? 'green' : 'standard');

/** Short chips, one per reason, strongest first. */
export function ReasonChips({ reasons }: { reasons: Reason[] }) {
  const sorted = [...reasons].sort((a, b) => b.points - a.points);
  return (
    <TagGroup>
      {sorted.map((r) => (
        <Tag key={r.text} text={r.points === 0 ? short(r) : `${signed(r.points)} ${short(r)}`} color={chipColor(r.points)} />
      ))}
    </TagGroup>
  );
}

/** The full reason sentences, as the ranking wrote them. */
export function ReasonLines({ reasons }: { reasons: Reason[] }) {
  return (
    <Stack space="space.025">
      {reasons.map((r) => (
        <Text key={r.text} size="small" color={r.points < 0 ? 'color.text.danger' : 'color.text'}>
          {`${signed(r.points)} ${r.text}`}
        </Text>
      ))}
    </Stack>
  );
}

/**
 * How much evidence one stand-in has, as a bar out of 12 points plus a
 * readable line, then the reasons as chips or as full sentences.
 */
export function Evidence({
  name,
  reasons,
  high,
  showAll = false,
  aside,
  points: given,
}: {
  name: string;
  reasons: Reason[];
  /** Context points when known without reasons (e.g. an alternative's contextPoints). */
  points?: number;
  /** True when the confidence is high: the bar turns green. */
  high: boolean;
  showAll?: boolean;
  /** Shown at the end of the evidence line, e.g. a confidence lozenge. */
  aside?: React.ReactNode;
}) {
  const points = given ?? contextPoints({ reasons });
  return (
    <Stack space="space.075">
      <Inline space="space.100" alignBlock="center" spread="space-between">
        <Text size="small" color="color.text.subtle">{`Evidence: ${plainNumber(points)} ${points === 1 ? 'point' : 'points'}`}</Text>
        {aside}
      </Inline>
      <ProgressBar
        value={Math.min(1, Math.max(0, points / FULL))}
        appearance={high ? 'success' : 'default'}
        ariaLabel={`Evidence that ${name} has context: ${plainNumber(points)} of ${FULL} points`}
      />
      {reasons.length > 0 && (showAll ? <ReasonLines reasons={reasons} /> : <ReasonChips reasons={reasons} />)}
    </Stack>
  );
}
