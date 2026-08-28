// src/app/game/[id]/GameLive.tsx — stub, replaced in Task 21
import type { RulesConfig } from '../../../lib/engine/types';
export function GameLive(_props: {
  gameId: string; status: 'active' | 'ended' | 'quarantined'; rules: RulesConfig;
  players: { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string }[];
  me: string; notableHands: {
    id: string; name: string; local_name: string | null;
    rarity: 'uncommon' | 'rare' | 'legendary';
  }[];
}) { return <div className="p-8">app game</div>; }
