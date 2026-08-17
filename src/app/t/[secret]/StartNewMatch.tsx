'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * Two-step destructive action. Step one arms it, step two performs it.
 *
 * The arming step is deliberately client-side state, not a second page: the whole point is
 * that the second press is a considered one, and a round trip would tempt a player to tap
 * ahead of the render on a slow table connection.
 *
 * The action is only ever reachable from the confirm step. There is no code path that
 * submits it from the first press — that is the property the tests pin down, because the
 * failure mode here is silent (a mis-wired first button voids a real match with no warning).
 */
export function StartNewMatch({ action }: { action: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="w-full rounded bg-black px-4 py-3 font-medium text-white"
      >
        Start new match
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded border border-gray-400 p-4">
      <form action={action}>
        <Confirming onCancel={() => setArmed(false)} />
      </form>
    </div>
  );
}

/**
 * Kept at module level rather than nested inside StartNewMatch: a component declared inside
 * another is a new component type on every render, so React unmounts and remounts the whole
 * subtree each time the parent re-renders.
 *
 * Separate from the parent because `useFormStatus` only reports on a form ABOVE it in the
 * tree, so this has to sit inside the <form> to see it at all.
 *
 * Both controls disappear together while the request is in flight. Cancel previously sat
 * outside the form and stayed live during the void: pressing it reverted the screen to the
 * un-armed state, telling the player nothing had happened, while the match was voided anyway.
 * A control that can no longer stop the action must not remain on screen implying it can.
 */
function Confirming({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();

  return (
    <div className="space-y-3">
      <p className={pending ? 'py-3 text-center font-medium' : ''} aria-live="polite">
        {pending ? 'Starting a new match…' : ''}
      </p>
      {!pending ? (
        <>
          <p className="font-medium">Are you sure? This will void the previous match in progress.</p>
          <button type="submit" className="w-full rounded bg-black px-4 py-3 font-medium text-white">
            Yes, void it and start new
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded border border-gray-400 px-4 py-3 font-medium"
          >
            Cancel
          </button>
        </>
      ) : null}
    </div>
  );
}
