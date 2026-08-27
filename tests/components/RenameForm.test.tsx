import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ renameMe: vi.fn(), refresh: vi.fn() }));
vi.mock('../../src/lib/actions/account', () => ({ renameMe: mocks.renameMe }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { RenameForm } from '../../src/app/account/RenameForm';

const field = () => screen.getByLabelText('Display name') as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('RenameForm', () => {
  it('starts from the name the player already has', () => {
    render(<RenameForm current="Bryan Lim" />);
    expect(field().value).toBe('Bryan Lim');
  });

  it('states the retroactive consequence before anyone saves', () => {
    render(<RenameForm current="Bryan Lim" />);
    expect(screen.getByText(/renames you everywhere/i)).toBeDefined();
  });

  it('stops typing at the length the database will accept', () => {
    render(<RenameForm current="Bryan Lim" />);
    expect(field().maxLength).toBe(40);
  });

  it('will not submit an empty name', () => {
    render(<RenameForm current="Bryan Lim" />);
    fireEvent.change(field(), { target: { value: '   ' } });
    expect((save() as HTMLButtonElement).disabled).toBe(true);
  });

  it('announces a save and refreshes so the board picks the name up', async () => {
    mocks.renameMe.mockResolvedValue({ status: 'saved', name: 'Orca' });
    render(<RenameForm current="Bryan Lim" />);
    fireEvent.change(field(), { target: { value: 'Orca' } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Saved\./)).toBeDefined());
    expect(mocks.refresh).toHaveBeenCalled();
  });

  // Not a failure: the database is reporting the name is already stored.
  it('reports an unchanged name neutrally, not as an error', async () => {
    mocks.renameMe.mockResolvedValue({ status: 'unchanged', name: 'Bryan Lim' });
    render(<RenameForm current="Bryan Lim" />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/already your name/i)).toBeDefined());
    const region = screen.getByRole('status');
    expect(region.textContent).not.toMatch(/error/i);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  /**
   * A failed save that also discarded the typed name would make the player retype it just to
   * find out whether the failure was a fluke.
   */
  it('keeps what was typed when the save fails', async () => {
    mocks.renameMe.mockResolvedValue({ status: 'failed' });
    render(<RenameForm current="Bryan Lim" />);
    fireEvent.change(field(), { target: { value: 'Orca' } });
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/Could not save/i)).toBeDefined());
    expect(field().value).toBe('Orca');
  });

  it('says what to do when the sign-in expired', async () => {
    mocks.renameMe.mockResolvedValue({ status: 'expired' });
    render(<RenameForm current="Bryan Lim" />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/sign-in expired/i)).toBeDefined());
  });

  it('reports an over-long name refused by the server', async () => {
    mocks.renameMe.mockResolvedValue({ status: 'invalid', reason: 'too_long' });
    render(<RenameForm current="Bryan Lim" />);
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByText(/40 characters or fewer/i)).toBeDefined());
  });
});
