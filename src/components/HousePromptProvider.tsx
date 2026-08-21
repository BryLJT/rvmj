'use client';

import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { HousePromptModal } from './HousePromptModal';
import { HOUSE_SETUP_PARAM, stripHouseMarker } from '../lib/houses';

type HousePrompt = { open: () => void };
const HousePromptContext = createContext<HousePrompt | null>(null);

/**
 * The address bar is an external store: it changes outside React, it is absent during server
 * rendering, and reading it in an effect would mean setting state synchronously on mount.
 * useSyncExternalStore is the API for exactly that shape — it hydrates from the server snapshot
 * (no marker), then re-reads on the client, with no effect and no cascading render.
 *
 * `replaceState` fires no event of its own, so stripping the marker notifies these listeners by
 * hand. That is what makes deferral close the modal: the marker IS the open state.
 */
const listeners = new Set<() => void>();

function notifyAddressChanged() {
  listeners.forEach((listener) => listener());
}

function subscribeToAddress(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const readMarker = () => new URLSearchParams(window.location.search).has(HOUSE_SETUP_PARAM);
const noMarkerOnServer = () => false;

export function useHousePrompt(): HousePrompt {
  const value = useContext(HousePromptContext);
  if (!value) throw new Error('useHousePrompt needs a HousePromptProvider above it');
  return value;
}

/**
 * Mounted once by the root layout, so one modal implementation serves both entry points: the
 * sign-in marker and the homepage action.
 */
export function HousePromptProvider({ children }: { children: ReactNode }) {
  const marked = useSyncExternalStore(subscribeToAddress, readMarker, noMarkerOnServer);
  const [launched, setLaunched] = useState(false);
  const router = useRouter();

  // replaceState, not a router navigation: deferring must leave the destination and its state
  // exactly as they were. Nothing is written to the database or the browser — a deferral is not
  // an opt-out, and the prompt is meant to return after the next sign-in.
  const close = useCallback(() => {
    setLaunched(false);
    const search = stripHouseMarker(window.location.search);
    if (search === window.location.search) return;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    );
    notifyAddressChanged();
  }, []);

  const saved = useCallback(() => {
    close();
    router.refresh();
  }, [close, router]);

  const value = useMemo<HousePrompt>(() => ({ open: () => setLaunched(true) }), []);

  return (
    <HousePromptContext.Provider value={value}>
      {children}
      {marked || launched ? <HousePromptModal onDefer={close} onSaved={saved} /> : null}
    </HousePromptContext.Provider>
  );
}
