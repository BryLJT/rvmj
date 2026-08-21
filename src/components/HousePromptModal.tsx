'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { ActionLink, Button, LiveRegion } from './ui';
import { chooseHouse } from '../lib/actions/house';
import { HOUSES, findHouse, type HouseId } from '../lib/houses';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SAVE_FAILED = 'We couldn’t save your house. Try again.';
const EXPIRED = 'Your sign-in expired before we could save your house.';

/**
 * The pop-up. Deliberately NOT FullScreenPanel: that component fills the viewport, and the
 * approved design keeps the destination visible behind a dimmed backdrop so the prompt reads as
 * an invitation rather than a gate.
 *
 * Four phases, because there are four things to show: choosing, saving, the resolved state when
 * another device got there first, and an expired session. `failed` is not a phase — a failure
 * returns to choosing with the selection intact, which is what "retains the selected house and
 * restores the confirmation control" means.
 */
export function HousePromptModal({ onDefer, onSaved }: { onDefer: () => void; onSaved: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const submittingRef = useRef(false);

  const [selected, setSelected] = useState<HouseId | null>(null);
  const [phase, setPhase] = useState<'choosing' | 'saving' | 'resolved' | 'expired'>('choosing');
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const confirm = async () => {
    // The ref, not the phase, is the guard: two taps in the same tick both see the old state.
    if (!selected || submittingRef.current) return;
    submittingRef.current = true;
    setPhase('saving');
    setMessage(undefined);
    try {
      const result = await chooseHouse(selected);
      if (result.status === 'saved') {
        onSaved();
        return;
      }
      if (result.status === 'already') {
        setPhase('resolved');
        setMessage(`Your house is already set to ${findHouse(result.house)?.name ?? result.house}.`);
        return;
      }
      if (result.status === 'expired') {
        setPhase('expired');
        setMessage(EXPIRED);
        return;
      }
      setPhase('choosing');
      setMessage(SAVE_FAILED);
    } catch {
      setPhase('choosing');
      setMessage(SAVE_FAILED);
    } finally {
      submittingRef.current = false;
    }
  };

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onDefer();
      return;
    }
    if (event.key !== 'Tab') return;

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

  // mousedown, not click: a drag that starts on a choice and ends on the backdrop still fires a
  // click on the backdrop, and dismissing a permanent decision on a stray drag is unforgivable.
  function handleBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onDefer();
  }

  const chosen = selected ? findHouse(selected) : null;

  return (
    <div data-testid="house-backdrop" onMouseDown={handleBackdrop}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/60 p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}
        className="w-full max-w-md rounded-[16px] border-2 border-ink bg-surface p-5 shadow-[0_6px_0_#142D37] sm:p-6">
        <h2 ref={titleRef} tabIndex={-1} id={titleId} className="text-2xl font-extrabold tracking-[-0.04em]">
          Choose your house
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Your house colours your leaderboard row and appears beside your name.
        </p>
        <p className="mt-4 rounded-[12px] border border-amber/30 bg-amber-soft px-4 py-3 text-sm leading-6 text-amber">
          <strong className="font-bold">Choose carefully.</strong> Your house cannot be changed later.
        </p>

        <div className="mt-4"><LiveRegion tone={phase === 'resolved' ? 'info' : 'error'} message={message} /></div>

        {phase === 'resolved' ? (
          <Button variant="primary" className="mt-5 w-full" onClick={onSaved}>Done</Button>
        ) : phase === 'expired' ? (
          <div className="mt-5 flex flex-col gap-3">
            <ActionLink href="/login" variant="primary">Sign in again</ActionLink>
            <Button variant="quiet" onClick={onDefer}>Choose later</Button>
          </div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {HOUSES.map((house) => (
                <button key={house.id} type="button" aria-pressed={selected === house.id}
                  disabled={phase === 'saving'}
                  onClick={() => setSelected(house.id)}
                  style={{ backgroundColor: house.fill, color: house.text }}
                  className={`flex min-h-16 items-center justify-center gap-2 rounded-[12px] border-2 px-3 py-3 text-base font-extrabold transition-[transform,box-shadow] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${selected === house.id ? 'border-ink shadow-[0_3px_0_#142D37]' : 'border-transparent'}`}>
                  <span>{house.name}</span>
                  {/* aria-hidden: aria-pressed already tells a screen reader. This check is the
                      non-colour signal for everyone else. */}
                  {selected === house.id ? <span aria-hidden="true">✓</span> : null}
                </button>
              ))}
            </div>
            <Button data-testid="house-confirm" variant="primary" className="mt-5 w-full"
              disabled={!selected} busy={phase === 'saving'} busyLabel="Saving..." onClick={confirm}>
              {chosen ? `Confirm ${chosen.name}` : 'Confirm'}
            </Button>
            <Button variant="quiet" className="mt-2 w-full" onClick={onDefer}>Choose later</Button>
          </>
        )}
      </div>
    </div>
  );
}
