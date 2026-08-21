import { NO_HOUSE_LABEL, type House } from '../lib/houses';

/**
 * One leaderboard row, house-coloured or neutral. A server component: no interactivity, so it
 * stays out of the client bundle and off the hydration path.
 *
 * On a house row the colour is set ONCE, on the li, and everything inherits it. That is why no
 * child carries a text-* class in that branch: the approved foreground/background pairs pass
 * contrast as pairs, and a leftover text-muted would quietly break one of them. Score direction
 * therefore rides on the plus or minus sign, never on red and green over a house colour.
 */
export function BoardRow({ rank, name, context, score, scoreTone, house }: {
  rank: number;
  name: string;
  context: string;
  score: string;
  scoreTone: 'gain' | 'loss' | 'neutral';
  house: House | null;
}) {
  const neutralScore = scoreTone === 'gain' ? 'text-gain' : scoreTone === 'loss' ? 'text-coral' : 'text-muted';
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
      <span className={`text-xl font-extrabold tabular-nums ${house ? '' : neutralScore}`}>{score}</span>
    </li>
  );
}
