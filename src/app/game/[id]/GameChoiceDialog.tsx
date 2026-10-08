'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Button, LiveRegion } from '../../../components/ui';
import { GAME_VARIANTS, type GameVariant } from '../../../lib/game-variant';

const FOCUSABLE = 'button:not([disabled])';

/**
 * "Which game was this?" Asked once, when the counter presses End match, and answered before the
 * match is saved. The answer decides which ladder the match counts on, and the two never mix.
 *
 * The two answers are drawn identically and neither is focused when the question opens. There is
 * no default on purpose: a pre-selected Regular would let somebody file a fei match on the wrong
 * ladder just by pressing the button twice.
 *
 * It opens INSIDE the result panel, which is itself a dialog with its own Tab trap. This one
 * keeps Tab among its own three buttons and stops the key travelling further, or the panel's trap
 * would walk focus out to the End and Recount buttons sitting behind the backdrop.
 *
 * Presentation only. Who may end the match, whether the table count is still current, and the
 * call itself all stay with the panel that opened it.
 */
export function GameChoiceDialog({ endingAs, disabled = false, error, onChoose, onCancel }: {
  /** The answer currently being saved, if any. Its button reads as busy and the other closes. */
  endingAs: GameVariant | null;
  /** The table count is being re-read, so no answer may be given yet. */
  disabled?: boolean;
  error?: string;
  onChoose: (variant: GameVariant) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const saving = endingAs !== null;

  // Focus goes to the heading, never to an answer: Enter or Space straight after opening must
  // not be able to choose a game. Focus returns to whatever opened the question when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => opener?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Backing out mid-save would hide a call that is still going to land.
      if (!saving) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    // The panel behind this has a Tab trap of its own. Left to bubble, it would treat focus inside
    // this dialog as focus inside the panel and hand it to a button behind the backdrop.
    event.stopPropagation();

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      titleRef.current?.focus();
      return;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!active || !focusable.includes(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // mousedown, not click: a press that starts on an answer and slides onto the backdrop still
  // fires a click on the backdrop, and that must not read as "cancel".
  function handleBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !saving) onCancel();
  }

  return (
    <div data-testid="game-choice-backdrop" onMouseDown={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/60 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-[16px] border-2 border-ink bg-surface p-5 shadow-[0_6px_0_#142D37] sm:p-6">
        <h2 ref={titleRef} tabIndex={-1} id={titleId} className="text-2xl font-extrabold tracking-[-0.04em]">
          Which game was this?
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Each game has its own leaderboard. This match will count on the one you pick.
        </p>

        <div className="mt-4"><LiveRegion tone="error" message={error} /></div>

        <div className="mt-4 flex flex-col gap-3">
          {(Object.keys(GAME_VARIANTS) as GameVariant[]).map((variant) => (
            <Button key={variant} className="w-full"
              disabled={disabled || (saving && endingAs !== variant)}
              busy={endingAs === variant} busyLabel="Ending…"
              onClick={() => onChoose(variant)}>
              {GAME_VARIANTS[variant].title}
            </Button>
          ))}
          <Button variant="quiet" disabled={saving} onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}
