import type { HandType } from '../components/HandTypeFilter';
import { isGameVariant, type GameVariant } from './game-variant';
import { isClaimId } from './notable-claim';
export type HistoryPlayer = {
  playerId: string;
  seat: 'E' | 'S' | 'W' | 'N';
  name: string;
  finalTotal: number | null;
};
export type HistoryGame = {
  id: string;
  mode: 'chips' | 'app';
  variant: GameVariant;
  endedAt: string;
  players: HistoryPlayer[];
};
export type HistoryResult = {
  status: 'ready';
  games: HistoryGame[];
  nextCursor: string | null;
} | {
  status: 'expired' | 'error';
};
export type HistoricalWin = {
  id: string;
  winnerName: string;
  handTypes: HandType[];
  hasPhoto: boolean;
};
export type GameDetailResult = {
  status: 'ready';
  game: HistoryGame;
  wins: HistoricalWin[] | null;
  catalogue: HandType[] | null;
} | {
  status: 'reopened';
  gameId: string;
} | {
  status: 'absent' | 'expired' | 'error';
};
export type HistoricalSave = {
  requestId: string;
  gameId: string;
  winnerId: string;
  handIds: string[];
  photo?: Blob;
};
export type HistoricalSaveResult = {
  status: 'saved';
  claimId: string;
} | {
  status: 'expired';
} | {
  status: 'error';
  message: string;
};
const seats = ['E', 'S', 'W', 'N'] as const;
export function parseHistoryGame(raw: unknown): HistoryGame | null {
  if (!raw || typeof raw !== 'object')
    return null;
  const row = raw as Record<string, unknown>;
  if (!isClaimId(row.id) || !isGameVariant(row.variant) || (row.mode !== 'chips' && row.mode !== 'app')
    || typeof row.ended_at !== 'string' || !Number.isFinite(Date.parse(row.ended_at)) || !Array.isArray(row.players))
    return null;
  const players: HistoryPlayer[] = [];
  for (const rawPlayer of row.players) {
    if (!rawPlayer || typeof rawPlayer !== 'object')
      return null;
    const p = rawPlayer as Record<string, unknown>;
    if (!isClaimId(p.player_id) || !seats.includes(p.seat as typeof seats[number]) || typeof p.display_name !== 'string')
      return null;
    // An unreadable stored total remains unavailable. Never recalculate it from today's rules.
    const total = typeof p.final_total === 'number' && Number.isFinite(p.final_total) ? p.final_total : null;
    players.push({ playerId: p.player_id, seat: p.seat as HistoryPlayer['seat'], name: p.display_name, finalTotal: total });
  }
  return { id: row.id, variant: row.variant, mode: row.mode, endedAt: row.ended_at, players: players.sort((a, b) => seats.indexOf(a.seat) - seats.indexOf(b.seat)) };
}
export function historyCursor(game: HistoryGame): string {
  return encodeURIComponent(JSON.stringify([game.endedAt, game.id]));
}
export function parseHistoryCursor(raw: unknown): {
  endedAt: string;
  id: string;
} | null {
  if (typeof raw !== 'string' || raw.length > 250)
    return null;
  try {
    const parts: unknown = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parts) || parts.length !== 2 || typeof parts[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(parts[0]) || !Number.isFinite(Date.parse(parts[0])) || !isClaimId(parts[1]))
      return null;
    return { endedAt: parts[0], id: parts[1] };
  }
  catch {
    return null;
  }
}
export function formatHistoryDate(value: string): string {
  return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(value));
}
export const pointsLabel = (total: number | null): string => total === null ? 'Result unavailable' : `${total > 0 ? '+' : ''}${total} pts`;
