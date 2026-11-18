'use client';
import { createContext, useContext, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { HistoryResult } from '../../lib/game-history';
type Snapshot = {
  viewerId: string;
  result: HistoryResult;
  scrollTop: number;
};
type HistoryCache = {
  snapshot: Snapshot | undefined;
  setSnapshot: Dispatch<SetStateAction<Snapshot | undefined>>;
};
const HistoryState = createContext<HistoryCache | null>(null);
function OwnerState({ children }: {
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  return <HistoryState.Provider value={{ snapshot, setSnapshot }}>{children}</HistoryState.Provider>;
}
/** The root layout survives visits to the existing photo page. Each cached snapshot carries
* its authenticated viewer ID; GameHistory refuses a snapshot belonging to another viewer. */
export function HistoryStateProvider({ ownerId, children }: {
  ownerId: string;
  children: ReactNode;
}) {
  return <OwnerState key={ownerId}>{children}</OwnerState>;
}
export const useHistoryState = () => useContext(HistoryState);
