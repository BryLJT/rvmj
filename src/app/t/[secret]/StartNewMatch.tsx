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
 * submits it from the first press — that is the property the test pins down, because the
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
      <p className="font-medium">Are you sure? This will void the previous match in progress.</p>
      <form action={action}>
        <ConfirmButton />
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="w-full rounded border border-gray-400 px-4 py-3 font-medium"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * Split out purely so it can call useFormStatus, which only reports the status of a form
 * ABOVE it in the tree. Disabling while pending stops a double press from firing the void
 * twice on a slow connection.
 */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded bg-black px-4 py-3 font-medium text-white disabled:opacity-60"
    >
      {pending ? 'Starting…' : 'Yes, void it and start new'}
    </button>
  );
}
