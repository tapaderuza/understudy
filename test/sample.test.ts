import { describe, expect, it } from 'vitest';
import { buildBrief } from '../src/core/brief';
import { SAMPLE, isSampleId, sampleSnapshot, sampleTeamSnapshot } from '../src/core/sample';
import { buildTeamRisk } from '../src/core/team';

const TODAY = '2026-12-01';

describe('sample data for empty sites', () => {
  it('shows a full handover: urgent cover, evidence, a single point of knowledge and spread load', () => {
    const b = buildBrief(sampleSnapshot(TODAY));
    expect(b.person.displayName).toBe('Nora Lind (sample)');
    expect(b.stats.open).toBe(7);
    expect(b.stats.must).toBeGreaterThanOrEqual(3);
    expect(b.stats.overdue).toBe(1);
    expect(b.soloKnowledge).toEqual(['TAX-4']);
    const close = b.items.find((x) => x.item.key === 'FIN-12');
    expect(close?.standIn?.displayName).toBe('Sam Okafor (sample)');
    expect(close?.confidence).toBe('high');
    expect(b.cover.length).toBeGreaterThanOrEqual(3);
    expect(b.sources.notes[0]).toMatch(/^Sample data/);
  });

  it('shows a team view with single points of knowledge for more than one person', () => {
    const t = buildTeamRisk(sampleTeamSnapshot(TODAY));
    expect(t.stats.solo).toBeGreaterThanOrEqual(2);
    expect(t.stats.readiness).toBeGreaterThan(0);
    expect(t.stats.readiness).toBeLessThan(100);
    expect(t.people.length).toBe(4);
    expect(t.atRisk.map((x) => x.item.key)).toContain('TAX-4');
  });

  it('marks every sample person so the page never treats them as real accounts', () => {
    for (const p of Object.values(SAMPLE)) {
      expect(isSampleId(p.accountId)).toBe(true);
      expect(p.displayName).toMatch(/\(sample\)$/);
    }
    expect(isSampleId('712020:abc')).toBe(false);
    expect(isSampleId(undefined)).toBe(false);
  });
});
