'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { Button } from './ui';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function FullScreenPanel({ title, eyebrow, onDismiss, children, footer }: {
  title: string;
  eyebrow?: string;
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
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
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
