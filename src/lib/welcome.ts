const KEY = 'rvmj:welcome-seen';

/**
 * localStorage is an external store, and a write from THIS tab fires no `storage` event, so
 * dismissal notifies by hand. Same shape as HousePromptProvider's address-bar store, and for
 * the same React 19 reason: reading it in an effect would mean setting state on mount.
 */
const listeners = new Set<() => void>();

export function subscribeToWelcomeSeen(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** No storage exists while the server renders, so the panel hydrates closed and opens on the client. */
export function noWelcomeSeenOnServer(): null {
  return null;
}

/**
 * Which match's welcome this browser has already dismissed.
 *
 * ONE key holding the latest match id, not a key per match: a player is in at most one game at a
 * time, so a single slot answers the only question asked of it and nothing accumulates across a
 * year of game nights. A miss costs a second look at the rules, which is harmless.
 */
export function readWelcomeSeen(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Safari private mode and blocked site data both throw on access. The welcome page showing
    // again is a far better failure than a leaderboard that will not render.
    return null;
  }
}

export function markWelcomeSeen(gameId: string): void {
  try {
    window.localStorage.setItem(KEY, gameId);
  } catch {
    // Nothing to do: the dismissal still holds for this mount, it just will not survive a reload.
  }
  listeners.forEach((listener) => listener());
}
