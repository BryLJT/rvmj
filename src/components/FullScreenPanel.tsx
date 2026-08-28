'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { Button } from './ui';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function FullScreenPanel({ title, eyebrow, label, onDismiss, children, footer }: {
  title: string;
  eyebrow?: string;
  /**
   * Accessible name for the dialog, when the visible heading alone would not identify it. Lets a
   * caller name the panel fully without padding the heading with words the surrounding text
   * already says. Omitted, the heading names the dialog as before.
   */
  label?: string;
  onDismiss?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();

    return () => opener?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && onDismiss) {
      event.preventDefault();
      onDismiss();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
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

  return (
    // One or the other, never both: `aria-labelledby` wins over `aria-label` wherever both are
    // present, which would silently ignore the name a caller asked for.
    <div ref={panelRef} role="dialog" aria-modal="true"
      {...(label ? { 'aria-label': label } : { 'aria-labelledby': titleId })}
      onKeyDown={handleKeyDown} className="fixed inset-0 z-50 overflow-y-auto bg-canvas">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-7 sm:px-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-coral">{eyebrow}</p><h2 ref={titleRef} tabIndex={-1} id={titleId} className="mt-2 text-3xl font-extrabold tracking-[-0.04em]">{title}</h2></div>
          {onDismiss ? <Button variant="quiet" onClick={onDismiss} aria-label={`Close ${title}`}>Close</Button> : null}
        </header>
        <div className="flex-1">{children}</div>
        {footer ? <footer className="mt-6">{footer}</footer> : null}
      </div>
    </div>
  );
}
