import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ChipCountForm } from '../../src/app/game/[id]/ChipCountForm';
import { emptyChipCountTable, cloneChipCountTable, SEAT_ORDER } from '../../src/app/game/[id]/chip-view';
import type { ChipCountTable, ChipPlayer } from '../../src/app/game/[id]/chip-view';
import { PER_PLAYER } from '../../src/lib/chips';

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
    expect(new Set(SEAT_ORDER.map((seat) => table[seat])).size).toBe(4);

    SEAT_ORDER.forEach((seat, changedIndex) => {
      table[seat][1] = changedIndex + 1;
      SEAT_ORDER.forEach((otherSeat, otherIndex) => {
        expect(table[otherSeat][1]).toBe(otherIndex <= changedIndex ? otherIndex + 1 : 0);
      });
    });
  });

  it('clones without sharing nested seat objects', () => {
    const original = emptyChipCountTable();
    const copy = cloneChipCountTable(original);
    expect(new Set(SEAT_ORDER.map((seat) => copy[seat])).size).toBe(4);

    SEAT_ORDER.forEach((seat, changedIndex) => {
      expect(copy[seat]).not.toBe(original[seat]);
      copy[seat][100] = changedIndex + 1;
      SEAT_ORDER.forEach((otherSeat, otherIndex) => {
        expect(copy[otherSeat][100]).toBe(otherIndex <= changedIndex ? otherIndex + 1 : 0);
        expect(original[otherSeat][100]).toBe(0);
      });
    });
  });
});

describe('ChipCountForm', () => {
  it('shows all four players and sixteen uniquely labelled numeric fields', () => {
    renderCountForm();
    const fields = screen.getAllByRole('spinbutton');
    expect(fields).toHaveLength(16);

    const labels = fields.map((field) => field.getAttribute('aria-label'));
    expect(new Set(labels).size).toBe(16);
    expect(new Set(labels)).toEqual(new Set([
      'Ah Seng · East · $1 chips',
      'Ah Seng · East · $10 chips',
      'Ah Seng · East · $50 chips',
      'Ah Seng · East · $100 chips',
      'Bryan · South · $1 chips',
      'Bryan · South · $10 chips',
      'Bryan · South · $50 chips',
      'Bryan · South · $100 chips',
      'Ah Beng · West · $1 chips',
      'Ah Beng · West · $10 chips',
      'Ah Beng · West · $50 chips',
      'Ah Beng · West · $100 chips',
      'Ah Huat · North · $1 chips',
      'Ah Huat · North · $10 chips',
      'Ah Huat · North · $50 chips',
      'Ah Huat · North · $100 chips',
    ]));

    for (const field of fields) {
      expect(field.getAttribute('inputmode')).toBe('numeric');
      expect(field.getAttribute('step')).toBe('1');
      expect(field.getAttribute('min')).toBe('0');
      // 44px minimum touch target, expressed as the shared min-h-11 token.
      expect(field.className).toContain('min-h-11');
    }
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
    const counts: ChipCountTable = {
      E: { 1: 1, 10: 2, 50: 3, 100: 4 },
      S: { 1: 2, 10: 3, 50: 4, 100: 5 },
      W: { 1: 3, 10: 4, 50: 5, 100: 6 },
      N: { 1: 4, 10: 5, 50: 6, 100: 7 },
    };
    renderCountForm({ counts });
    const expectedPlayerTotals = [
      ['Ah Seng · East · $1 chips', '571'],
      ['Bryan · South · $1 chips', '732'],
      ['Ah Beng · West · $1 chips', '893'],
      ['Ah Huat · North · $1 chips', '1054'],
    ] as const;
    for (const [fieldName, total] of expectedPlayerTotals) {
      const section = screen.getByRole('spinbutton', { name: fieldName }).closest('section');
      expect(section).not.toBeNull();
      expect(within(section as HTMLElement).getByText(total)).toBeDefined();
    }
    expect(screen.getByText('Table total 3250 / 1600')).toBeDefined();
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
    expect(footer.className).toContain('bottom-[env(safe-area-inset-bottom)]');
    expect(footer.className).toContain('pb-4');
    const safeAreaPadding = footer.className
      .split(/\s+/)
      .filter((token) => /^p(?:[xytrbl])?-\[.*safe-area-inset-bottom/.test(token));
    expect(safeAreaPadding).toEqual([]);
    expect(within(footer).getByText(/Table total/)).toBeDefined();
    expect(within(footer).getByRole('button', { name: 'Check all counts' })).toBeDefined();
    const finalSection = screen.getByRole('spinbutton', { name: 'Ah Huat · North · $100 chips' }).closest('section');
    expect(finalSection?.parentElement?.className).toContain('pb-32');
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

describe('ChipCountForm review round 1', () => {
  // min/step are hints to the spinner, not validation. A negative or fractional count reaches the
  // server and comes back as a raw validation string instead of the recount guidance.
  it('refuses negative and fractional counts', () => {
    const onCountsChange = vi.fn();
    renderCountForm({ onCountsChange });
    const field = screen.getByRole('spinbutton', { name: 'Bryan · South · $10 chips' });
    fireEvent.change(field, { target: { value: '-2' } });
    expect((onCountsChange.mock.calls[0][0] as ChipCountTable).S[10]).toBe(0);
    fireEvent.change(field, { target: { value: '1.5' } });
    expect((onCountsChange.mock.calls[1][0] as ChipCountTable).S[10]).toBe(1);
  });

  it('treats a cleared field as zero rather than NaN', () => {
    const onCountsChange = vi.fn();
    renderCountForm({ onCountsChange });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Ah Beng · West · $50 chips' }), { target: { value: '' } });
    expect((onCountsChange.mock.calls[0][0] as ChipCountTable).W[50]).toBe(0);
  });

  // A field showing 0 with the caret before it turns an intended 5 into 50. Selecting on focus
  // means the first keystroke always replaces the placeholder zero.
  it('selects the existing count when a field is focused', () => {
    renderCountForm();
    const field = screen.getByRole('spinbutton', { name: 'Ah Seng · East · $1 chips' }) as HTMLInputElement;
    const select = vi.fn();
    field.select = select;
    fireEvent.focus(field);
    expect(select).toHaveBeenCalled();
  });

  it('uses a generic recount lead and the whole-table tail for an empty failed-denomination list', () => {
    renderCountForm({ failure: { failedDenominations: [], grandTotalOff: true } });
    expect(screen.getByText(
      'The counts do not add up. Recount every stack. The whole table total is also off.',
    )).toBeDefined();
  });

  it('uses a generic recount lead and the offset tail for an empty failed-denomination list', () => {
    renderCountForm({ failure: { failedDenominations: [], grandTotalOff: false } });
    expect(screen.getByText(
      'The counts do not add up. Recount every stack. The table still totals correctly, so two stacks offset each other.',
    )).toBeDefined();
  });

  it('takes its seat order from the shared engine constant', async () => {
    const { SEATS } = await import('../../src/lib/engine/types');
    expect([...SEAT_ORDER]).toEqual([...SEATS]);
  });
});
