import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ChipEndFlow } from '../../src/app/game/[id]/ChipEndFlow';
import { proposeChipCounts } from '../../src/lib/actions/game';

vi.mock('../../src/lib/actions/game', () => ({
  proposeChipCounts: vi.fn(async () => ({ conservation: { failedDenominations: [1, 10], grandTotalOff: false } })),
  confirmChipResult: vi.fn(async () => ({})),
}));
vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { pending_counts: null, pending_confirmed: [], status: 'active' } }) }) }) }),
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
    removeChannel: () => {},
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

// vitest runs without `globals: true`, so @testing-library's auto-cleanup never registers —
// without this, each test renders into a DOM still holding the previous test's overlay.
afterEach(cleanup);

describe('ChipEndFlow recount loop (spec §8.6/§10)', () => {
  it('renders a recount prompt that NAMES each failed denomination', async () => {
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Check & propose/));
    await waitFor(() => {
      // Must name BOTH $1 and $10. A generic "count doesn't balance" message fails this
      // assertion — that is the guard-must-fail property, verified in Step 6.
      expect(screen.getByText(/\$1 and \$10/)).toBeDefined();
    });
  });

  // Carried directive 5: a REJECTED server-action promise (transport failure at the table)
  // must not leave the button stuck disabled — try/catch/finally, not try/finally alone.
  it('re-enables Check & propose and surfaces an error when the action rejects', async () => {
    vi.mocked(proposeChipCounts).mockRejectedValueOnce(new Error('network down'));
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /Check & propose/ });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/network down/)).toBeDefined();
    });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  // Carried directive 4: this overlay (the second in the app) carries dialog semantics
  // and closes on Escape — a phone keyboard/bluetooth keyboard user can back out.
  it('is a labelled modal dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(<ChipEndFlow gameId="g1" players={players} me="p2" onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
