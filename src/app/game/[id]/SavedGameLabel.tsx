import { variantGameLabel, type GameVariant } from '../../../lib/game-variant';

/**
 * Which game a finished match was saved as, on the result screen.
 *
 * Only the phone that ended the match saw the question, so this is where the other three learn
 * the answer. Boxed like the score chips so it reads as a fact about the match rather than as a
 * heading, and the same on every phone.
 */
export function SavedGameLabel({ variant }: { variant: GameVariant }) {
  return (
    <p className="mb-4 inline-flex items-center self-start rounded-[9px] border-2 border-ink bg-cobalt-soft px-3 py-1.5 text-sm font-extrabold">
      {variantGameLabel(variant)}
    </p>
  );
}
