import { NO_HOUSE_LABEL, type House } from '../lib/houses';

/**
 * One leaderboard row, house-coloured or neutral. A server component: no interactivity, so it
 * stays out of the client bundle and off the hydration path.
 *
 * On a house row the colour is set ONCE, on the li, and everything inherits it. That is why no
 * child carries a text-* class in that branch: the approved foreground/background pairs pass
 * contrast as pairs, and a leftover text-muted would quietly break one of them.
 *
 * The ONE exception is the score, and it earns it by bringing its own background. Measured against
 * all seven fills, gain (#24715D) lands between 1.18:1 and 4.31:1 and coral (#ED6048) between
 * 1.25:1 and 2.55:1 — every single one below the floor, so these colours can never sit directly on
 * a house. No single replacement pair exists either: clearing 3:1 on the palest house demands a
 * luminance under 0.208 and on Rusa demands over 0.324, and those windows do not overlap. A chip
 * sidesteps the whole problem — on `surface` the same two colours reach 5.75:1 and 3.24:1, and at
 * text-xl extra-bold the score is large text, where 3:1 is the bar. The sign still carries direction
 * independently of colour, so nothing depends on hue alone.
 */
export function BoardRow({ rank, name, context, score, scoreTone, house }: {
  rank: number;
  name: string;
  context: string;
  score: string;
  scoreTone: 'gain' | 'loss' | 'neutral';
  house: House | null;
}) {
  const directional = scoreTone === 'gain' || scoreTone === 'loss';
  const scoreColour = scoreTone === 'gain' ? 'text-gain' : scoreTone === 'loss' ? 'text-coral' : 'text-muted';
  return (
    <li
      style={house ? { backgroundColor: house.fill, color: house.text } : undefined}
      className={`grid min-h-16 grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-[12px] px-3 py-3 ${house ? 'border-2 border-ink' : 'border border-divider bg-surface'}`}>
      <span className={`text-sm font-bold tabular-nums ${house ? '' : 'text-muted'}`} aria-label={`Rank ${rank}`}>{rank}</span>
      <div className="min-w-0">
        <p className={`truncate font-bold ${house ? '' : 'text-ink'}`}>{name}</p>
        <p className={`truncate text-xs font-semibold ${house ? '' : 'text-muted'}`}>{house ? house.name : NO_HOUSE_LABEL}</p>
        <p className={`truncate text-xs ${house ? '' : 'text-muted'}`}>{context}</p>
      </div>
      {directional ? (
        <span className={`inline-flex items-center rounded-[9px] border-[1.5px] border-ink bg-surface px-2.5 py-1 text-xl font-extrabold tabular-nums ${scoreColour}`}>
          {score}
        </span>
      ) : (
        <span className={`text-xl font-extrabold tabular-nums ${house ? '' : scoreColour}`}>{score}</span>
      )}
    </li>
  );
}
