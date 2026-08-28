import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HandTypeFilter, type HandType } from '../../src/components/HandTypeFilter';

/**
 * The twelve seeded hand types, in the order migration 0001 inserts them — which is neither
 * alphabetical nor grouped. The panel does its own grouping and sorting, so a catalogue read
 * that returns rows in any order still renders the same twelve controls in the same places.
 *
 * The IDs deliberately do not sort like the names ('h10' sorts before 'h2'), so an assertion
 * about display order cannot pass by accident on an implementation that ordered by ID.
 */
const CATALOGUE: HandType[] = [
  { id: 'h1', name: 'Thirteen Wonders', local_name: '十三幺', rarity: 'legendary' },
  { id: 'h2', name: 'Heavenly Hand', local_name: '天糊', rarity: 'legendary' },
  { id: 'h3', name: 'Earthly Hand', local_name: '地糊', rarity: 'legendary' },
  { id: 'h4', name: 'Great Winds', local_name: '大四喜', rarity: 'legendary' },
  { id: 'h5', name: 'Big Three Dragons', local_name: '大三元', rarity: 'rare' },
  { id: 'h6', name: 'Small Three Dragons', local_name: '小三元', rarity: 'rare' },
  { id: 'h7', name: 'All Pungs', local_name: '碰碰胡', rarity: 'uncommon' },
  { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' },
  { id: 'h9', name: 'Mixed Suit', local_name: '混一色', rarity: 'uncommon' },
  { id: 'h10', name: 'Kong on Kong', local_name: '杠上开花', rarity: 'rare' },
  { id: 'h11', name: 'Robbing the Kong', local_name: '抢杠', rarity: 'rare' },
  { id: 'h12', name: 'Last Tile Catch', local_name: '海底捞月', rarity: 'rare' },
];

const details = (container: HTMLElement) => container.querySelector('details') as HTMLDetailsElement;
const form = (container: HTMLElement) => container.querySelector('form') as HTMLFormElement;
const checkboxValues = (scope: ParentNode) =>
  [...scope.querySelectorAll('input[name="hand"]')].map((input) => (input as HTMLInputElement).value);

afterEach(cleanup);

describe('HandTypeFilter', () => {
  it('puts the whole catalogue behind one Filter hand types control', () => {
    const { container } = render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={[]} year="all" />);

    const summary = screen.getByText('Filter hand types');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')).toBe(details(container));
    expect(checkboxValues(details(container))).toHaveLength(12);
    // Closed until asked for. The board exists to show the ranking; the filter is the detour.
    expect(details(container).open).toBe(false);
  });

  it('groups all twelve types Uncommon, Rare, Legendary and sorts each group by name', () => {
    const { container } = render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={[]} year="all" />);

    const groups = [...container.querySelectorAll('fieldset')];
    expect(groups.map((group) => group.querySelector('legend')?.textContent))
      .toEqual(['Uncommon', 'Rare', 'Legendary']);
    expect(checkboxValues(groups[0])).toEqual(['h7', 'h9']);
    expect(checkboxValues(groups[1])).toEqual(['h5', 'h10', 'h12', 'h8', 'h11', 'h6']);
    expect(checkboxValues(groups[2])).toEqual(['h3', 'h4', 'h2', 'h1']);
    for (const hand of CATALOGUE) expect(screen.getByText(hand.name)).toBeTruthy();
  });

  /**
   * The address is the whole state of this board, so the panel is a plain GET form: what the
   * browser would actually submit is asserted here through FormData rather than by reading
   * attributes, because that is the thing a player's tap produces.
   *
   * `board` and the year ride along hidden, or applying a filter would also throw the player
   * back to Total score at the default period.
   */
  it('submits the checked types as repeated hand fields, carrying the board and year', () => {
    const { container } = render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={['h1', 'h7']} year={2026} />);

    const panel = form(container);
    expect(panel.getAttribute('action')).toBe('/');
    expect(panel.method).toBe('get');

    const submitted = new FormData(panel);
    expect(submitted.get('board')).toBe('skill');
    expect(submitted.get('year')).toBe('2026');
    expect(submitted.getAll('hand')).toEqual(['h7', 'h1']);

    // Checking a third type adds a third `hand` field rather than replacing the other two.
    fireEvent.click(screen.getByRole('checkbox', { name: /Mixed Suit/ }));
    expect(new FormData(panel).getAll('hand')).toEqual(['h7', 'h9', 'h1']);

    // Something has to send it. Without a real submit control the panel is only usable by a
    // player who happens to know that Enter submits a form.
    const submit = screen.getByRole('button', { name: 'Show matching wins' });
    expect(submit.getAttribute('type')).toBe('submit');
    expect(panel.contains(submit)).toBe(true);
  });

  it('carries All time as the year rather than dropping the period', () => {
    const { container } = render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={[]} year="all" />);

    expect(new FormData(form(container)).get('year')).toBe('all');
  });

  /**
   * Spec §10.3: the selections stay visible above the ranking once the panel closes. Chips
   * inside the closed panel would leave a player looking at a filtered board with nothing on
   * screen explaining why it is short.
   */
  it('keeps every selected type visible as its own removable chip outside the panel', () => {
    const { container } = render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={['h1', 'h7']} year={2026} />);

    expect(details(container).open).toBe(false);
    const chips = screen.getAllByRole('link', { name: /^Remove / });
    expect(chips.map((chip) => chip.getAttribute('aria-label')))
      .toEqual(['Remove All Pungs', 'Remove Thirteen Wonders']);
    for (const chip of chips) expect(details(container).contains(chip)).toBe(false);
  });

  it('shows no chips and no Clear all while nothing is selected', () => {
    render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={[]} year="all" />);

    expect(screen.queryAllByRole('link', { name: /^Remove / })).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Clear all' })).toBeNull();
  });

  it('removes one type while preserving every other selection and the year', () => {
    render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={['h1', 'h7', 'h9']} year={2026} />);

    expect(screen.getByRole('link', { name: 'Remove Mixed Suit' }).getAttribute('href'))
      .toBe('/?board=skill&year=2026&hand=h1&hand=h7');
    expect(screen.getByRole('link', { name: 'Remove All Pungs' }).getAttribute('href'))
      .toBe('/?board=skill&year=2026&hand=h1&hand=h9');
  });

  it('clears every hand parameter without changing board or year', () => {
    render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={['h1', 'h7', 'h9']} year={2026} />);

    expect(screen.getByRole('link', { name: 'Clear all' }).getAttribute('href'))
      .toBe('/?board=skill&year=2026');
  });

  /**
   * Spec §10.3. Without this sentence a multi-select reads as "and", and a player who picks
   * three types expects the one hand that was all three at once — then sees a board that looks
   * broken because it is showing hands that were only one of them.
   */
  it('states that any selected type qualifies and that more matches rank first', () => {
    render(<HandTypeFilter handTypes={CATALOGUE} selectedIds={['h7']} year="all" />);

    expect(screen.getByText(
      'A win qualifies if it matches any selected type. Wins matching more of them rank first.',
    )).toBeTruthy();
  });
});
