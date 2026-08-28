import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NotableWinRow, parseNotableWins } from '../../src/components/NotableWinRow';
import type { HandType } from '../../src/components/HandTypeFilter';

const pungs: HandType = { id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' };
const pure: HandType = { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' };
const thirteen: HandType = { id: 'h1', name: 'Thirteen Wonders', local_name: '十三幺', rarity: 'legendary' };

/** One row as the database function returns it: labels already ordered by name, then ID. */
const row = (over: Record<string, unknown> = {}) => ({
  claim_id: 'c1',
  player_id: 'p1',
  display_name: 'Ah Seng',
  house: null,
  created_at: '2026-08-27T17:30:00Z',
  hand_types: [
    { id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' },
    { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' },
  ],
  total_label_count: 2,
  selected_match_count: 0,
  ...over,
});

afterEach(cleanup);

describe('NotableWinRow', () => {
  /**
   * Spec §10: a ranked item is one physical WIN, and it shows the winner, the Singapore date,
   * every label it carries, and how many that is.
   *
   * 17:30 UTC is 01:30 the next morning in Singapore — the after-midnight tail of a long night.
   * The date a player recognises is the Singapore one, so the row must read 28 Aug, not 27.
   */
  it('shows the rank, the winner, the Singapore date, every label and the total count', () => {
    render(<ol><NotableWinRow rank={3} winnerName="Ah Seng" wonAt="2026-08-27T17:30:00Z"
      handTypes={[pungs, pure, thirteen]} /></ol>);

    // The rank reaches a screen reader as text rather than as an aria-label a bare span cannot
    // carry, and the eye sees the number once rather than hearing it twice.
    expect(screen.getByText('Rank 3')).toBeTruthy();
    expect(screen.getByText('3', { selector: '[aria-hidden]' })).toBeTruthy();

    expect(screen.getByRole('listitem')).toBeTruthy();
    expect(screen.getByText('Ah Seng')).toBeTruthy();
    expect(screen.getByText('28 Aug 2026')).toBeTruthy();
    // Rendered in the order given. The database already ordered the labels; a row that re-sorted
    // them would be a second opinion about an order that is settled next to the data.
    //
    // Found by ROLE AND ACCESSIBLE NAME, not by reading the aria-label attribute: `getByLabelText`
    // matches the raw attribute, so it stays green on a bare div whose name no screen reader is
    // ever given. `getByRole` computes the name the way assistive tech does.
    const chips = screen.getByRole('group', { name: 'Hand types' });
    expect([...chips.children].map((chip) => chip.textContent))
      .toEqual(['All Pungs', 'Pure Suit', 'Thirteen Wonders']);
    expect(screen.getByText('3 labels')).toBeTruthy();
  });

  // One physical win carrying one label is still one win, and must not read as "1 labels".
  it('says 1 label for a single-label win', () => {
    render(<ol><NotableWinRow rank={1} winnerName="Bryan" wonAt="2026-01-02T04:00:00Z"
      handTypes={[thirteen]} /></ol>);

    expect(screen.getByText('1 label')).toBeTruthy();
    expect(screen.queryByText('1 labels')).toBeNull();
    expect(screen.getByText('Thirteen Wonders')).toBeTruthy();
  });
});

describe('parseNotableWins', () => {
  it('reads one win per row, in the order the database returned them', () => {
    const wins = parseNotableWins([
      row({ claim_id: 'c2', display_name: 'Bryan' }),
      row({ claim_id: 'c1', display_name: 'Ah Seng' }),
    ]);

    expect(wins?.map((win) => [win.claimId, win.winnerName])).toEqual([['c2', 'Bryan'], ['c1', 'Ah Seng']]);
    expect(wins?.[0].handTypes).toEqual([pungs, pure]);
    expect(wins?.[0].wonAt).toBe('2026-08-27T17:30:00Z');
  });

  // jsonb normally arrives already parsed, but a driver or a view that hands back the raw text
  // must not turn a real win into a broken board.
  it('accepts hand_types delivered as JSON text', () => {
    const wins = parseNotableWins([row({ hand_types: JSON.stringify([pungs, pure]) })]);

    expect(wins?.[0].handTypes).toEqual([pungs, pure]);
  });

  it('keeps a null local name, which most types outside the catalogue seed would have', () => {
    const wins = parseNotableWins([row({ hand_types: [{ ...pungs, local_name: null }] })]);

    expect(wins?.[0].handTypes).toEqual([{ ...pungs, local_name: null }]);
  });

  /**
   * A row whose labels cannot be read is a broken board, not a win with fewer labels than it
   * really has. Rendering it anyway would quietly understate what somebody did at the table,
   * and would move it down a ranking that is ordered by label count.
   */
  it.each([
    ['a missing hand_types value', { hand_types: null }],
    ['hand_types that is not JSON at all', { hand_types: 'not json' }],
    ['hand_types that is not an array', { hand_types: { id: 'h7' } }],
    ['a win with no labels, which the database cannot produce', { hand_types: [] }],
    ['a label missing its name', { hand_types: [{ id: 'h7', local_name: null, rarity: 'uncommon' }] }],
    ['a label with a rarity outside the catalogue', { hand_types: [{ ...pungs, rarity: 'mythic' }] }],
    ['a missing claim id', { claim_id: null }],
    ['a missing winner', { display_name: null }],
    ['a missing win time', { created_at: null }],
    ['a win time that is text but not a date', { created_at: 'nope' }],
  ])('refuses the whole board for %s', (_case, broken) => {
    expect(parseNotableWins([row(), row(broken)])).toBeNull();
  });

  it('reads an empty result as an empty board rather than a broken one', () => {
    expect(parseNotableWins([])).toEqual([]);
  });
});
