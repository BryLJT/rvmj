import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ChipCountForm } from '../../src/app/game/[id]/ChipCountForm';
import { emptyChipCountTable, cloneChipCountTable, SEAT_ORDER } from '../../src/app/game/[id]/chip-view';
import type { ChipCountTable, ChipPlayer } from '../../src/app/game/[id]/chip-view';
import { PER_PLAYER, STACK_TOTAL, TABLE_TOTAL, stackTotal } from '../../src/lib/chips';

const players: ChipPlayer[] = [
  { playerId: 'p1', seat: 'E', name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S', name: 'Bryan' },
  { playerId: 'p3', seat: 'W', name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N', name: 'Ah Huat' },
];

type Props = Partial<Parameters<typeof ChipCountForm>[0]>;
const renderCountForm = (over: Props = {}) =>
  render(
    <ChipCountForm
      players={players}
      counts={over.counts ?? emptyChipCountTable()}
      onCountsChange={over.onCountsChange ?? vi.fn()}
      onSubmit={over.onSubmit ?? vi.fn()}
      onClose={over.onClose ?? vi.fn()}
      failure={over.failure}
      error={over.error}
      success={over.success}
      submitting={over.submitting}
      syncBlocked={over.syncBlocked}
    />,
  );

afterEach(cleanup);

describe('chip-view helpers', () => {
  // A shared nested object means typing into East's $1 field silently changes all four seats.
  it('gives every seat its own denomination object', () => {
    const table = emptyChipCountTable();
    table.E[1] = 7;
    expect(table.S[1]).toBe(0);
    expect(table.W[1]).toBe(0);
    expect(table.N[1]).toBe(0);
  });

  it('clones without sharing nested seat objects', () => {
    const original = emptyChipCountTable();
    const copy = cloneChipCountTable(original);
    copy.N[100] = 4;
    expect(original.N[100]).toBe(0);
    for (const seat of SEAT_ORDER) expect(copy[seat]).not.toBe(original[seat]);
  });
});

describe('ChipCountForm', () => {
  it('shows all four players and sixteen uniquely labelled numeric fields', () => {
    renderCountForm();
    expect(screen.getAllByRole('spinbutton')).toHaveLength(16);
    const first = screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' });
    expect(first.getAttribute('inputmode')).toBe('numeric');
    expect(first.getAttribute('step')).toBe('1');
    const last = screen.getByRole('spinbutton', { name: 'Ah Huat · North · $100 chips' });
    expect(last.getAttribute('min')).toBe('0');
    // 44px minimum touch target, expressed as the shared min-h-11 token.
    expect(first.className).toContain('min-h-11');
  });

  it('shows the starting quantity for every denomination', () => {
    renderCountForm();
    for (const d of [1, 10, 50, 100] as const) {
      expect(screen.getAllByText(`Start ${PER_PLAYER[d]}`).length).toBeGreaterThan(0);
    }
  });

  it('updates one player and the whole-table total without mutating the supplied table', () => {
    const counts = emptyChipCountTable();
    const onCountsChange = vi.fn();
    renderCountForm({ counts, onCountsChange });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Bryan · South · $100 chips' }), { target: { value: '3' } });
    expect(counts.S[100]).toBe(0);
    expect(onCountsChange).toHaveBeenCalledWith(
      expect.objectContaining({ S: expect.objectContaining({ 100: 3 }) }),
    );
    const next = onCountsChange.mock.calls[0][0] as ChipCountTable;
    expect(next).not.toBe(counts);
    expect(next.E).not.toBe(counts.E);
  });

  it('shows each player total and the whole-table total from the authoritative helpers', () => {
    const counts = emptyChipCountTable();
    for (const seat of SEAT_ORDER) Object.assign(counts[seat], PER_PLAYER);
    renderCountForm({ counts });
    expect(screen.getAllByText(String(stackTotal(PER_PLAYER))).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(`Table total ${TABLE_TOTAL} / ${TABLE_TOTAL}`)).toBeDefined();
    expect(stackTotal(PER_PLAYER)).toBe(STACK_TOTAL);
  });

  it('names every failed denomination and explains offset stacks', () => {
    renderCountForm({ failure: { failedDenominations: [1, 10], grandTotalOff: false } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('$1 and $10');
    expect(status.textContent).toContain('two stacks offset each other');
  });

  it('names three failed denominations and says when the whole table is off', () => {
    renderCountForm({ failure: { failedDenominations: [1, 10, 50], grandTotalOff: true } });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('$1, $10 and $50');
    expect(status.textContent).toContain('whole table total is also off');
  });

  it('keeps the whole-table total and action in a sticky footer', () => {
    renderCountForm();
    const footer = screen.getByTestId('count-summary');
    expect(footer.className).toContain('sticky');
    expect(within(footer).getByText(/Table total/)).toBeDefined();
    expect(within(footer).getByRole('button', { name: 'Check all counts' })).toBeDefined();
  });

  it('blocks the action while the table state is being rechecked', () => {
    renderCountForm({ syncBlocked: true });
    expect((screen.getByRole('button', { name: 'Check all counts' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Checking the latest table count…')).toBeDefined();
  });

  // An error is the more specific message; the generic sync notice must not compete with it.
  it('does not show the sync notice when a real error is present', () => {
    renderCountForm({ syncBlocked: true, error: 'could not reach the table' });
    expect(screen.queryByText('Checking the latest table count…')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('could not reach the table');
  });

  it('shows pending copy and blocks a second submit while submitting', () => {
    renderCountForm({ submitting: true });
    const action = screen.getByRole('button', { name: 'Checking counts…' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
  });

  it('calls onSubmit once when the counts are checked', () => {
    const onSubmit = vi.fn();
    renderCountForm({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: 'Check all counts' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // Sixteen fields on a 360px phone: any fixed or minimum width forces sideways scrolling,
  // which is the one thing the spec rules out for this screen.
  it('uses no fixed or minimum widths that would force horizontal scrolling', () => {
    const { container } = renderCountForm();
    const html = container.innerHTML;
    // No pinned pixel widths, and nothing that opts the page into sideways scrolling.
    expect(html).not.toMatch(/\bw-\[\d/);
    expect(html).not.toMatch(/\bmin-w-\[/);
    expect(html).not.toMatch(/\boverflow-x-(?:scroll|auto)\b/);
    // min-w-11 is the mandated 44px touch target, not a layout hazard. Anything meaningfully
    // wider than that, times four columns, is what pushes a 360px phone sideways.
    const minWidths = [...html.matchAll(/\bmin-w-(\d+)\b/g)].map((m) => Number(m[1]));
    expect(minWidths.every((n) => n <= 11)).toBe(true);
  });
});
