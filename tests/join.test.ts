import { describe, it, expect } from 'vitest';
import { decideJoin, FORMING_TTL_MS, ACTIVE_TTL_MS, type GameSnapshot } from '../src/lib/join';

const now = new Date('2026-08-04T12:00:00Z');
const tap = (playerId: string, seat: 'E' | 'S' | 'W' | 'N') => ({ playerId, seat, now });
const game = (o: Partial<GameSnapshot>): GameSnapshot => ({
  id: 'g1', status: 'forming', createdAt: now, lastActivityAt: now, seats: {}, ...o,
});

describe('decideJoin', () => {
  it('no game → create forming', () => {
    expect(decideJoin(null, tap('p1', 'E'))).toEqual({ action: 'create_forming' });
  });
  it('stale forming (>30min) → expire and create', () => {
    const stale = game({ createdAt: new Date(now.getTime() - FORMING_TTL_MS - 1) });
    expect(decideJoin(stale, tap('p1', 'E'))).toEqual({ action: 'expire_and_create', expireGameId: 'g1' });
  });
  it('forming, free seat → claim', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p2', 'S'))).toEqual({ action: 'claim_seat', gameId: 'g1' });
  });
  it('forming, seat taken by someone else → reject', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p2', 'E'))).toEqual({ action: 'reject', reason: 'seat_taken' });
  });
  it('forming, own seat re-tapped → rejoin (no duplicate claim)', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p1', 'E'))).toEqual({ action: 'rejoin', gameId: 'g1' });
  });
  it('forming, player taps a different free seat → move (one account, one seat)', () => {
    expect(decideJoin(game({ seats: { E: 'p1' } }), tap('p1', 'S'))).toEqual({ action: 'move_seat', gameId: 'g1', fromSeat: 'E' });
  });
  it('active, participant re-taps → rejoin', () => {
    const g = game({ status: 'active', seats: { E: 'p1', S: 'p2', W: 'p3', N: 'p4' } });
    expect(decideJoin(g, tap('p3', 'W'))).toEqual({ action: 'rejoin', gameId: 'g1' });
    expect(decideJoin(g, tap('p3', 'E'))).toEqual({ action: 'rejoin', gameId: 'g1' }); // any tag rejoins; seats are locked
  });
  it('active, outsider (fifth player) → reject', () => {
    const g = game({ status: 'active', seats: { E: 'p1', S: 'p2', W: 'p3', N: 'p4' } });
    expect(decideJoin(g, tap('p5', 'E'))).toEqual({ action: 'reject', reason: 'game_in_progress' });
  });
  it('active but silent >12h → auto-end and create fresh', () => {
    const g = game({ status: 'active', seats: { E: 'p1' }, lastActivityAt: new Date(now.getTime() - ACTIVE_TTL_MS - 1) });
    expect(decideJoin(g, tap('p5', 'E'))).toEqual({ action: 'end_stale_and_create', endGameId: 'g1' });
  });

  describe('TTL boundaries (expiry is strictly greater-than, not at-or-after)', () => {
    it('forming exactly at 30min is still live → normal seat logic', () => {
      const g = game({ createdAt: new Date(now.getTime() - FORMING_TTL_MS), seats: { E: 'p1' } });
      expect(decideJoin(g, tap('p2', 'S'))).toEqual({ action: 'claim_seat', gameId: 'g1' });
    });
    it('active exactly at 12h silence is still live → participant rejoins', () => {
      const g = game({
        status: 'active',
        seats: { E: 'p1', S: 'p2', W: 'p3', N: 'p4' },
        lastActivityAt: new Date(now.getTime() - ACTIVE_TTL_MS),
      });
      expect(decideJoin(g, tap('p2', 'S'))).toEqual({ action: 'rejoin', gameId: 'g1' });
    });
    it('forming staleness is measured from createdAt, not lastActivityAt', () => {
      const g = game({ createdAt: new Date(now.getTime() - FORMING_TTL_MS - 1), lastActivityAt: now });
      expect(decideJoin(g, tap('p1', 'E'))).toEqual({ action: 'expire_and_create', expireGameId: 'g1' });
    });
    it('active staleness is measured from lastActivityAt, not createdAt', () => {
      const g = game({
        status: 'active',
        createdAt: new Date(now.getTime() - ACTIVE_TTL_MS - 1),
        lastActivityAt: now,
        seats: { E: 'p1', S: 'p2', W: 'p3', N: 'p4' },
      });
      expect(decideJoin(g, tap('p1', 'E'))).toEqual({ action: 'rejoin', gameId: 'g1' });
    });
  });

  describe('guard precedence', () => {
    it('stale forming expires even when the tapper owns that seat', () => {
      const g = game({ createdAt: new Date(now.getTime() - FORMING_TTL_MS - 1), seats: { E: 'p1' } });
      expect(decideJoin(g, tap('p1', 'E'))).toEqual({ action: 'expire_and_create', expireGameId: 'g1' });
    });
    it('stale active ends even when the tapper is a participant', () => {
      const g = game({
        status: 'active',
        seats: { E: 'p1', S: 'p2', W: 'p3', N: 'p4' },
        lastActivityAt: new Date(now.getTime() - ACTIVE_TTL_MS - 1),
      });
      expect(decideJoin(g, tap('p1', 'E'))).toEqual({ action: 'end_stale_and_create', endGameId: 'g1' });
    });
    it('forming, seated player taps a seat held by someone else → seat_taken, not move', () => {
      const g = game({ seats: { E: 'p1', S: 'p2' } });
      expect(decideJoin(g, tap('p1', 'S'))).toEqual({ action: 'reject', reason: 'seat_taken' });
    });
    it('forming, unseated player taps a free seat → claim, never move', () => {
      const g = game({ seats: { E: 'p1', S: 'p2', W: 'p3' } });
      expect(decideJoin(g, tap('p4', 'N'))).toEqual({ action: 'claim_seat', gameId: 'g1' });
    });
  });

  describe('TTL constants', () => {
    it('forming TTL is 30 minutes and active TTL is 12 hours', () => {
      expect(FORMING_TTL_MS).toBe(30 * 60 * 1000);
      expect(ACTIVE_TTL_MS).toBe(12 * 60 * 60 * 1000);
    });
  });
});
