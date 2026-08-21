'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HousePromptModal } from './HousePromptModal';
import { HOUSE_SETUP_PARAM, stripHouseMarker } from '../lib/houses';

type HousePrompt = { open: () => void };
const HousePromptContext = createContext<HousePrompt | null>(null);

export function useHousePrompt(): HousePrompt {
  const value = useContext(HousePromptContext);
  if (!value) throw new Error('useHousePrompt needs a HousePromptProvider above it');
  return value;
}

/**
 * Mounted once by the root layout, so one modal implementation serves both entry points.
 *
 * The marker is read from window.location in an effect rather than through useSearchParams:
 * the marker only ever arrives on a full document load from the OAuth callback, and reading it
 * this way keeps every static route in the app out of a client-side rendering bailout.
 */
export function HousePromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has(HOUSE_SETUP_PARAM)) setOpen(true);
  }, []);

  // replaceState, not a router navigation: deferring must leave the destination and its state
  // exactly as they were. Nothing is written to the database or the browser — a deferral is not
  // an opt-out, and the prompt is meant to return after the next sign-in.
  const close = useCallback(() => {
    setOpen(false);
    const search = stripHouseMarker(window.location.search);
    if (search === window.location.search) return;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  }, []);

  const saved = useCallback(() => {
    close();
    router.refresh();
  }, [close, router]);

  const value = useMemo<HousePrompt>(() => ({ open: () => setOpen(true) }), []);

  return (
    <HousePromptContext.Provider value={value}>
      {children}
      {open ? <HousePromptModal onDefer={close} onSaved={saved} /> : null}
    </HousePromptContext.Provider>
  );
}
