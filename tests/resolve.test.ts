import { describe, expect, it } from 'vitest';
import { diceSimilarity, normalize, resolveEntity, resolveOne } from '../src/domain/resolve.js';
import { makeTestContext } from './helpers/fake-context.js';

describe('normalize', () => {
  it('lowercases, strips diacritics and collapses spaces', () => {
    expect(normalize('  Quantânio   Refinado ')).toBe('quantanio refinado');
  });
});

describe('diceSimilarity', () => {
  it('rates close misspellings highly', () => {
    expect(diceSimilarity('laranita', 'Laranite')).toBeGreaterThan(0.7);
  });
  it('rates unrelated strings low', () => {
    expect(diceSimilarity('gold', 'Widow')).toBeLessThan(0.3);
  });
});

describe('resolveEntity', () => {
  it('matches the PT nickname "laranita" to Laranite', async () => {
    const ctx = makeTestContext();
    const { candidates } = await resolveEntity(ctx, 'laranita', 'commodity');
    expect(candidates[0]?.name).toBe('Laranite');
  });

  it('matches the code prefix "LAR"', async () => {
    const ctx = makeTestContext();
    const { candidates } = await resolveEntity(ctx, 'LAR', 'commodity');
    expect(candidates[0]?.name).toBe('Laranite');
  });

  it('matches exact names case-insensitively with score 1', async () => {
    const ctx = makeTestContext();
    const { candidates } = await resolveEntity(ctx, 'laranite', 'commodity');
    expect(candidates[0]).toMatchObject({ name: 'Laranite', score: 1 });
  });

  it('maps the PT alias "quantânio" to Quantainium', async () => {
    const ctx = makeTestContext();
    const { candidates } = await resolveEntity(ctx, 'quantânio', 'commodity');
    expect(candidates[0]?.name).toBe('Quantainium');
  });

  it('finds Area 18 terminals from the spaceless form "Area18"', async () => {
    const ctx = makeTestContext();
    const { candidates } = await resolveEntity(ctx, 'Area18', 'terminal', 10);
    expect(candidates.some((c) => c.name.includes('Area 18'))).toBe(true);
  });

  it('resolves "C2" to the C2 Hercules Starlifter with its SCU capacity', async () => {
    const ctx = makeTestContext();
    const { candidates } = await resolveEntity(ctx, 'C2', 'vehicle');
    expect(candidates[0]?.name).toBe('Crusader C2 Hercules Starlifter');
    expect(candidates[0]?.extra['scu']).toBe(696);
  });

  it('flags illegal commodities in extra', async () => {
    const ctx = makeTestContext();
    const { candidates } = await resolveEntity(ctx, 'Maze', 'commodity');
    expect(candidates[0]?.extra['is_illegal']).toBe(true);
  });
});

describe('resolveOne', () => {
  it('returns ok for a clear winner', async () => {
    const ctx = makeTestContext();
    const result = await resolveOne(ctx, 'Stanton', 'star_system');
    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') expect(result.candidate.name).toBe('Stanton');
  });

  it('returns ambiguous when several terminals tie', async () => {
    const ctx = makeTestContext();
    const result = await resolveOne(ctx, 'TDD', 'terminal');
    expect(result.outcome).toBe('ambiguous');
    if (result.outcome === 'ambiguous') expect(result.candidates.length).toBeGreaterThan(1);
  });

  it('prefers the refined variant when raw and refined tie exactly', async () => {
    const ctx = makeTestContext();
    const result = await resolveOne(ctx, 'Gold', 'commodity');
    expect(result.outcome).toBe('ok');
    if (result.outcome === 'ok') {
      expect(result.candidate.name).toBe('Gold');
      expect(result.candidate.extra['is_raw']).toBe(false);
    }
  });

  it('returns not_found for gibberish', async () => {
    const ctx = makeTestContext();
    const result = await resolveOne(ctx, 'xyzzyplugh', 'commodity');
    expect(result.outcome).toBe('not_found');
  });
});
