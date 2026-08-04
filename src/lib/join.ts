import type { Seat } from './engine/types';

export interface GameSnapshot {
  id: string;
  status: 'forming' | 'active';
  createdAt: Date;
  lastActivityAt: Date;
  seats: Partial<Record<Seat, string>>; // seat → playerId
}

export interface Tap { playerId: string; seat: Seat; now: Date }

export type JoinDecision =
  | { action: 'create_forming' }
  | { action: 'expire_and_create'; expireGameId: string }
  | { action: 'end_stale_and_create'; endGameId: string }
  | { action: 'claim_seat'; gameId: string }
  | { action: 'move_seat'; gameId: string; fromSeat: Seat }
  | { action: 'rejoin'; gameId: string }
  | { action: 'reject'; reason: 'seat_taken' | 'game_in_progress' };

export const FORMING_TTL_MS = 30 * 60 * 1000;
export const ACTIVE_TTL_MS = 12 * 60 * 60 * 1000;

function seatOf(game: GameSnapshot, playerId: string): Seat | undefined {
  return (Object.entries(game.seats) as [Seat, string][]).find(([, p]) => p === playerId)?.[0];
}

export function decideJoin(game: GameSnapshot | null, tap: Tap): JoinDecision {
  if (!game) return { action: 'create_forming' };

  if (game.status === 'forming') {
    if (tap.now.getTime() - game.createdAt.getTime() > FORMING_TTL_MS)
      return { action: 'expire_and_create', expireGameId: game.id };
    const occupant = game.seats[tap.seat];
    if (occupant === tap.playerId) return { action: 'rejoin', gameId: game.id };
    if (occupant) return { action: 'reject', reason: 'seat_taken' };
    const current = seatOf(game, tap.playerId);
    if (current) return { action: 'move_seat', gameId: game.id, fromSeat: current };
    return { action: 'claim_seat', gameId: game.id };
  }

  // active
  if (tap.now.getTime() - game.lastActivityAt.getTime() > ACTIVE_TTL_MS)
    return { action: 'end_stale_and_create', endGameId: game.id };
  if (seatOf(game, tap.playerId)) return { action: 'rejoin', gameId: game.id };
  return { action: 'reject', reason: 'game_in_progress' };
}
