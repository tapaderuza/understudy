// Stand-ins chosen in chat, before names are resolved to people. Pure.

export interface StandInChoice {
  /** Jira work item key, upper case. */
  key: string;
  /** What the person typed for the stand-in: a name, an email or an account ID. */
  who: string;
}

const CHOICE = /^\s*([A-Za-z][A-Za-z0-9_]*-\d{1,9})\s*(?:=|:|->|\bto\b)\s*(.+?)\s*$/i;

/**
 * Reads "PAY-3=Max Taylor; PAY-5: Cassi Owens, OPS-1 -> Ryan" into choices.
 * Pairs are split on semicolons, new lines, or a comma that starts a new
 * pair; anything that is not "KEY = person" is ignored. The last choice for a
 * key wins, and at most 50 are read.
 */
export function parseStandInChoices(text: unknown): StandInChoice[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const parts = text.slice(0, 4000).split(/[;\n]+|,(?=\s*[A-Za-z][A-Za-z0-9_]*-\d)/);
  const byKey = new Map<string, string>();
  for (const part of parts) {
    const m = CHOICE.exec(part);
    if (m && m[1] && m[2]) byKey.set(m[1].toUpperCase(), m[2].replace(/^["']|["']$/g, '').trim());
  }
  return [...byKey.entries()].slice(0, 50).map(([key, who]) => ({ key, who }));
}
