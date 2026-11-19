import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  updateNotableWinHands: vi.fn(),
  deleteNotableWin: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('../../src/lib/actions/game', () => ({
  updateNotableWinHands: mocks.updateNotableWinHands,
  deleteNotableWin: mocks.deleteNotableWin,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));

import { NotableWinEditControls } from '../../src/components/NotableWinEditControls';

const CLAIM_ID = '3f1a5e0c-0d7b-4a2e-9f1b-7c2d8e4a6b90';
const CATALOGUE = [
  { id: 'h1', name: 'All Pungs', local_name: null, rarity: 'uncommon' as const },
  { id: 'h2', name: 'Full Flush', local_name: null, rarity: 'rare' as const },
  { id: 'h3', name: 'Thirteen Wonders', local_name: '十三幺', rarity: 'legendary' as const },
];

const view = (catalogue = CATALOGUE) => render(
  <NotableWinEditControls claimId={CLAIM_ID} currentHandIds={['h1']} catalogue={catalogue} backHref="/?board=skill" />,
);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateNotableWinHands.mockResolvedValue({});
  mocks.deleteNotableWin.mockResolvedValue({});
});
afterEach(cleanup);

describe('changing hands', () => {
  it('starts with the win\'s current tags ticked and saves the new selection', async () => {
    view();
    click('Change hands');
    expect((screen.getByLabelText('All Pungs') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Full Flush') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByLabelText('All Pungs'));
    fireEvent.click(screen.getByLabelText('Full Flush'));
    click('Save hands');

    await waitFor(() => expect(mocks.updateNotableWinHands).toHaveBeenCalledWith(CLAIM_ID, ['h2']));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });

  it('will not save with nothing ticked', () => {
    view();
    click('Change hands');
    fireEvent.click(screen.getByLabelText('All Pungs'));
    click('Save hands');

    expect(mocks.updateNotableWinHands).not.toHaveBeenCalled();
    expect(screen.getByText('Choose at least one hand type.')).toBeTruthy();
  });

  it('shows a refusal and stays in the editor', async () => {
    mocks.updateNotableWinHands.mockResolvedValue({ error: 'you did not play in this game' });
    view();
    click('Change hands');
    click('Save hands');

    await waitFor(() => expect(screen.getByText('you did not play in this game')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Save hands' })).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('cancel discards the ticks', () => {
    view();
    click('Change hands');
    fireEvent.click(screen.getByLabelText('Full Flush'));
    click('Cancel');
    click('Change hands');

    expect((screen.getByLabelText('Full Flush') as HTMLInputElement).checked).toBe(false);
  });

  it('offers no editing without a catalogue, but still offers delete', () => {
    view([]);
    expect(screen.queryByRole('button', { name: 'Change hands' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete this win' })).toBeTruthy();
  });
});

describe('deleting', () => {
  it('asks first and deletes nothing until confirmed', () => {
    view();
    click('Delete this win');

    expect(screen.getByText(/This is permanent/)).toBeTruthy();
    expect(mocks.deleteNotableWin).not.toHaveBeenCalled();
  });

  it('keep it backs out without deleting', () => {
    view();
    click('Delete this win');
    click('Keep it');

    expect(mocks.deleteNotableWin).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete this win' })).toBeTruthy();
  });

  it('confirming deletes and leaves the page for the board', async () => {
    view();
    click('Delete this win');
    click('Yes, delete this win');

    await waitFor(() => expect(mocks.deleteNotableWin).toHaveBeenCalledWith(CLAIM_ID));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/?board=skill'));
  });

  it('a refusal stays on the page and says why', async () => {
    mocks.deleteNotableWin.mockResolvedValue({ error: 'you did not play in this game' });
    view();
    click('Delete this win');
    click('Yes, delete this win');

    await waitFor(() => expect(screen.getByText('you did not play in this game')).toBeTruthy());
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
