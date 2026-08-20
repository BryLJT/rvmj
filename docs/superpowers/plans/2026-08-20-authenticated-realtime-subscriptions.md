# Authenticated Realtime Subscriptions Implementation Plan

> **Execution:** Use the written-plan, isolated-worktree, test-driven-development, and verification workflows.

**Goal:** Ensure every gameplay Realtime channel joins as the signed-in player before listening for table changes, and visibly fail closed if the live connection cannot be established.

**Architecture:** Add one browser-side subscription gate that restores the existing Supabase session, explicitly attaches its access token to Realtime, and only then builds and subscribes the channel. `FormingScreen`, `ChipLive`, and `ChipEndFlow` use that gate while retaining their table-specific handlers and reload logic. The gate owns asynchronous startup and cleanup; each screen owns its player-facing response to lifecycle statuses.

**Tech Stack:** Next.js 16.3, React 19.2, TypeScript, `@supabase/ssr` 0.12.4, `@supabase/supabase-js` 2.112.0, Vitest 4.1, Testing Library.

**Spec:** `docs/handoffs/2026-08-20-forming-realtime-bug.md`

## Global constraints

- Do not push, deploy, commit, or change hosted database permissions as part of implementation. Bryan separately requested and approved pushing the pre-existing migration commit `bbb10ab` before this work began.
- Never print, log, display, or persist a Supabase access token or NFC seat secret.
- Keep all existing channel names, Postgres filters, reload callbacks, foreground recovery, and stale-state locks intact.
- The auth gate must run before `.subscribe()`, not merely before the WebSocket reports `SUBSCRIBED`.
- A component unmounted during session restoration must never subscribe afterward.
- Cleanup-triggered `CLOSED` statuses must not show a false connection error.
- Tests come first and must be observed failing against the old behavior.
- Automated verification cannot close the production bug by itself. Final acceptance still requires two real signed-in phones after Bryan separately approves a push/deploy.

## Task 1: Shared authenticated subscription gate

**Files:**

- Create: `src/lib/supabase/realtime.ts`
- Create: `tests/realtime.test.ts`

- [x] Write an ordering test proving `getSession` → `setAuth` → channel construction → `.subscribe()`.
- [x] Test no-session failure, cleanup winning restoration, established-channel removal, and cleanup `CLOSED` suppression.
- [x] Test cleanup during token attachment and a same-topic remount while channel removal is still pending.
- [x] Observe RED because the helper does not exist.
- [x] Implement the minimal authenticated gate.
- [x] Serialize same-topic removal/startup so Supabase cannot reuse a channel still in `leaving`.
- [x] Verify GREEN: 6/6 helper tests pass.

## Task 2: Route all gameplay subscriptions through the gate

**Files:**

- Modify: `src/app/game/[id]/FormingScreen.tsx`
- Modify: `src/app/game/[id]/ChipLive.tsx`
- Modify: `src/app/game/[id]/ChipEndFlow.tsx`
- Modify: `src/app/game/[id]/NotableLogger.tsx`
- Modify their three component test files.

- [x] Add a failing FormingScreen connection-error/recovery test.
- [x] Add a failing ChipLive timeout/fail-closed test.
- [x] Add a failing ChipEndFlow unexpected-close/fail-closed test.
- [x] Observe RED: only the 3 new tests fail; 60 pre-existing focused tests pass.
- [x] Route all three components through the shared gate.
- [x] Preserve existing channels, filters, callbacks, reloads, foreground recovery, and cleanup.
- [x] Keep Realtime failures latched across successful HTTP refreshes until a new `SUBSCRIBED`.
- [x] Keep an open notable-hand draft visible but block its action while the live channel is failed.
- [x] Keep FormingScreen recovery visible after manual seat refresh until Realtime reconnects.
- [x] Verify GREEN: 66/66 tests across the three subscription screens pass (71/71 including the directly affected NotableLogger suite).

## Task 3: Document and verify

- [x] Update the handoff with the controlled reproduction, local implementation, and production acceptance boundary.
- [x] Run `npm test` — 24 files, 249 tests passed.
- [x] Run `npm run typecheck` as an early implementation check; repeat in the final verification sequence.
- [x] Run `npm run lint` — 0 errors, one known untouched warning.
- [x] Run the supported `npm run build -- --webpack` fallback successfully after default Turbopack was blocked by the sandbox's internal port-binding restriction.
- [ ] Re-run the default `npm run build` in an unrestricted environment before deployment.
- [x] Run `git diff --check`.
- [x] Complete an independent read-only code review and address all merge-blocking findings.
- [x] Inspect repository status and diff without committing.
- [x] Update Alfred's RVMJ project checkpoint and short-term dashboard.

The database harness is not required because this plan does not touch `supabase/`.
