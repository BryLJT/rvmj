import type { Seat } from './engine/types';

export interface GameSnapshot {
  id: string;
  status: 'forming' | 'active';
  createdAt: Date;
  lastActivityAt: Date;
  seats: Partial<Record<Seat, string>>; // seat → playerId
}

export interface Tap { playerId: string; seat: Seat; now: Date }

/**
 * One select string for both readers. `mode` is carried so the caller can pick the right
 * clearing RPC and the right warning copy WITHOUT a second query — the earlier second
 * lookup dropped its error and could misread a chip game as an app game.
 */
export const OPEN_GAME_SELECT =
  'id, status, mode, created_at, last_activity_at, game_players(player_id, seat)';

/** The open-game row as the tap route and the confirmation action both select it. */
export interface OpenGameRow {
  id: string;
  status: string;
  /** Selected so callers never need a second lookup to tell a chip game from an app game. */
  mode?: string;
  created_at: string;
  last_activity_at: string;
  game_players?: { player_id: string; seat: string }[] | null;
}

/**
 * Row → snapshot. Shared deliberately: the tap page and the confirm-and-clear action must
 * decide from the SAME view of the table, or a confirmation could clear a game the page
 * never showed as abandoned.
 */
export function toSnapshot(row: OpenGameRow | null | undefined): GameSnapshot | null {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as 'forming' | 'active',
    createdAt: new Date(row.created_at),
    lastActivityAt: new Date(row.last_activity_at),
    seats: Object.fromEntries((row.game_players ?? []).map((p) => [p.seat, p.player_id])),
  };
}

export type JoinDecision =
  | { action: 'create_forming' }
  | { action: 'expire_and_create'; expireGameId: string }
  // A game that was actually PLAYED and never ended. Unlike a stale forming game
  // (nothing recorded, nothing to lose), clearing this destroys a real night of play,
  // so it is never silent — the tapper is told what is at stake and must confirm.
  | { action: 'confirm_end_stale'; staleGameId: string }
  | { action: 'claim_seat'; gameId: string }
  | { action: 'move_seat'; gameId: string; fromSeat: Seat }
  | { action: 'rejoin'; gameId: string }
  | { action: 'reject'; reason: 'seat_taken' | 'table_full' | 'game_in_progress' };

export const FORMING_TTL_MS = 30 * 60 * 1000;
export const ACTIVE_TTL_MS = 12 * 60 * 60 * 1000;

const SEAT_COUNT = 4;

function seatOf(game: GameSnapshot, playerId: string): Seat | undefined {
  return (Object.entries(game.seats) as [Seat, string][]).find(([, p]) => p === playerId)?.[0];
}

function isTableFull(game: GameSnapshot): boolean {
  return Object.values(game.seats).filter(Boolean).length === SEAT_COUNT;
}

export function decideJoin(game: GameSnapshot | null, tap: Tap): JoinDecision {
  if (!game) return { action: 'create_forming' };

  if (game.status === 'forming') {
    if (tap.now.getTime() - game.createdAt.getTime() > FORMING_TTL_MS)
      return { action: 'expire_and_create', expireGameId: game.id };
    const occupant = game.seats[tap.seat];
    if (occupant === tap.playerId) return { action: 'rejoin', gameId: game.id };
    // Hoisted above the seat_taken check: a full table must reject an outsider as
    // table_full, and every seat is occupied in that state, so seat_taken would
    // otherwise swallow it. Seated players fall through to the checks below.
    const current = seatOf(game, tap.playerId);
    if (!current && isTableFull(game)) return { action: 'reject', reason: 'table_full' };
    if (occupant) return { action: 'reject', reason: 'seat_taken' };
    if (current) return { action: 'move_seat', gameId: game.id, fromSeat: current };
    return { action: 'claim_seat', gameId: game.id };
  }

  // active
  if (tap.now.getTime() - game.lastActivityAt.getTime() > ACTIVE_TTL_MS)
    return { action: 'confirm_end_stale', staleGameId: game.id };
  if (seatOf(game, tap.playerId)) return { action: 'rejoin', gameId: game.id };
  return { action: 'reject', reason: 'game_in_progress' };
}
