// src/app/game/[id]/ChipLive.tsx — stub, replaced in Task 14
export function ChipLive(_props: {
  gameId: string; status: 'active' | 'ended';
  players: { playerId: string; seat: 'E' | 'S' | 'W' | 'N'; name: string }[];
  me: string; notableHands: { id: string; name: string; local_name: string | null }[];
}) { return <div className="p-8">chip game</div>; }
