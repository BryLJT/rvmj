import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { settleEvent, assertZeroSum } from '../../src/lib/engine/engine';
import { settleBonus } from '../../src/lib/engine/bonus';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError, SEATS, type Movements, type RulesConfig, type ScoringEvent, type Seat, type ShooterMode } from '../../src/lib/engine/types';

// A spy that delegates to the real settler, so every other test in this file exercises the
// genuine engine. Individual tests use mockReturnValueOnce to make one call misbehave.
vi.mock('../../src/lib/engine/bonus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/engine/bonus')>();
  return { ...actual, settleBonus: vi.fn(actual.settleBonus) };
});

const seatArb = fc.constantFrom<Seat>('E', 'S', 'W', 'N');

const rulesArb: fc.Arbitrary<RulesConfig> = fc
  .record({
    cap: fc.integer({ min: 1, max: 13 }),
    shooter: fc.constantFrom<ShooterMode>('off', 'half', 'full'),
    scale: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 13, maxLength: 13 }),
  })
  .map(({ cap, shooter, scale }) => ({
    taiToPoints: [0, ...scale.slice(0, cap)],
    minTai: 1,
    taiCap: cap,
    shooter,
    startingDisplayTotal: 400,
    bustLine: -1200,
  }));

const eventArb: fc.Arbitrary<ScoringEvent> = fc.oneof(
  fc
    .record({ winner: seatArb, discarder: seatArb, selfDraw: fc.boolean(), tai: fc.integer({ min: 1, max: 20 }) })
    .filter(({ winner, discarder, selfDraw }) => selfDraw || winner !== discarder)
    .map(({ winner, discarder, selfDraw, tai }) =>
      selfDraw
        ? ({ type: 'win', winner, winKind: 'self_draw', tai } as ScoringEvent)
        : ({ type: 'win', winner, winKind: 'discard', discarder, tai } as ScoringEvent),
    ),
  fc
    .record({
      kind: fc.constantFrom('pair_dealt', 'pair_drawn', 'kong_concealed', 'kong_added', 'kong_exposed' as const),
      beneficiary: seatArb,
      discarder: seatArb,
    })
    .filter(({ kind, beneficiary, discarder }) => kind !== 'kong_exposed' || beneficiary !== discarder)
    .map(({ kind, beneficiary, discarder }) =>
      ({ type: 'bonus', kind, beneficiary, ...(kind === 'kong_exposed' ? { discarder } : {}) }) as ScoringEvent,
    ),
);

describe('settleEvent', () => {
  it('dispatches wins and bonuses', () => {
    expect(settleEvent({ type: 'win', winner: 'E', winKind: 'self_draw', tai: 1 }, DEFAULT_RULES))
      .toEqual({ E: 6, S: -2, W: -2, N: -2 });
    expect(settleEvent({ type: 'bonus', kind: 'pair_drawn', beneficiary: 'S' }, DEFAULT_RULES))
      .toEqual({ E: -1, S: 3, W: -1, N: -1 });
  });

  it('runs the guard: an unbalanced settler result never escapes', () => {
    // Without this, "settleEvent asserts before returning" is untested — every other test
    // here passes just as well with the assertZeroSum call deleted, because the real
    // settlers are already balanced. Force one to misbehave and the guard must fire.
    vi.mocked(settleBonus).mockReturnValueOnce({ E: 1, S: 0, W: 0, N: 0 });
    expect(() => settleEvent({ type: 'bonus', kind: 'pair_drawn', beneficiary: 'S' }, DEFAULT_RULES))
      .toThrow(EngineError);
  });

  it('LAW: every valid event settles to zero-sum, under any rules', () => {
    fc.assert(
      fc.property(eventArb, rulesArb, (event, rules) => {
        const m = settleEvent(event, rules);
        return SEATS.reduce((acc, s) => acc + m[s], 0) === 0;
      }),
      { numRuns: 5000 },
    );
  });
});

describe('assertZeroSum', () => {
  it('accepts balanced, rejects unbalanced', () => {
    expect(() => assertZeroSum({ E: 1, S: -1, W: 0, N: 0 })).not.toThrow();
    expect(() => assertZeroSum({ E: 1, S: 0, W: 0, N: 0 })).toThrow(EngineError);
  });

  // Assert the key check specifically, not just "something threw" — an extra key can trip
  // the sum check and a missing seat trips it via NaN, so a bare toThrow would pass here
  // even with the key check deleted.
  const expectKeyError = (m: unknown) => {
    const call = () => assertZeroSum(m as Movements);
    expect(call).toThrow(EngineError);
    expect(call).toThrow(/keys must be exactly/);
  };

  it('rejects a phantom seat key even when the four real seats are present', () => {
    // A movements object built from an invalid discarder can carry a fifth key. Summing over
    // SEATS alone would silently ignore it, so the key set itself must be exactly E,S,W,N.
    expectKeyError({ E: 0, S: 0, W: 3, N: 0, X: -3 });
    // The case the key check exists for: balanced across the four real seats, so the sum
    // check alone would wave it through while a phantom seat quietly holds points.
    expectKeyError({ E: 1, S: -1, W: 0, N: 0, X: 5 });
  });

  it('rejects a movements object missing a seat', () => {
    expectKeyError({ E: 1, S: -1, W: 0 });
  });
});
