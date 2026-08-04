import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { settleEvent, assertZeroSum } from '../../src/lib/engine/engine';
import { DEFAULT_RULES } from '../../src/lib/engine/defaults';
import { EngineError, SEATS, type Movements, type RulesConfig, type ScoringEvent, type Seat } from '../../src/lib/engine/types';

const seatArb = fc.constantFrom<Seat>('E', 'S', 'W', 'N');

const rulesArb: fc.Arbitrary<RulesConfig> = fc
  .record({
    cap: fc.integer({ min: 1, max: 13 }),
    shooter: fc.boolean(),
    scale: fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 13, maxLength: 13 }),
  })
  .map(({ cap, shooter, scale }) => ({
    taiToPoints: [0, ...scale.slice(0, cap)],
    minTai: 1,
    taiCap: cap,
    shooter,
    startingDisplayTotal: 1000,
    bustLine: -3000,
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

  it('rejects a phantom seat key even when the four real seats are present', () => {
    // A movements object built from an invalid discarder can carry a fifth key. Summing over
    // SEATS alone would silently ignore it, so the key set itself must be exactly E,S,W,N.
    expect(() => assertZeroSum({ E: 0, S: 0, W: 3, N: 0, X: -3 } as unknown as Movements)).toThrow(EngineError);
    // The case the key check exists for: balanced across the four real seats, so the sum
    // check alone would wave it through while a phantom seat quietly holds points.
    expect(() => assertZeroSum({ E: 1, S: -1, W: 0, N: 0, X: 5 } as unknown as Movements)).toThrow(EngineError);
  });

  it('rejects a movements object missing a seat', () => {
    expect(() => assertZeroSum({ E: 1, S: -1, W: 0 } as unknown as Movements)).toThrow(EngineError);
  });
});
