import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ chooseHouse: vi.fn() }));
vi.mock('../../src/lib/actions/house', () => ({ chooseHouse: mocks.chooseHouse }));

import { HousePromptModal } from '../../src/components/HousePromptModal';

const onDefer = vi.fn();
const onSaved = vi.fn();
const show = () => render(<HousePromptModal onDefer={onDefer} onSaved={onSaved} />);
const confirmButton = () => screen.getByTestId('house-confirm');

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chooseHouse.mockResolvedValue({ status: 'saved', house: 'rusa' });
});

describe('house prompt modal', () => {
  it('is a labelled modal dialog carrying the approved copy', () => {
    show();
    const dialog = screen.getByRole('dialog');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Choose your house' })).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby'))
      .toBe(screen.getByRole('heading', { name: 'Choose your house' }).id);
    expect(screen.getByText('Your house colours your leaderboard row and appears beside your name.')).toBeTruthy();
    expect(screen.getByText('Choose carefully.')).toBeTruthy();
    expect(screen.getByText(/Your house cannot be changed later\./)).toBeTruthy();
  });

  it('offers all seven houses with their exact approved colours', () => {
    show();
    const expected = [
      ['Manis', 'rgb(191, 227, 242)', 'rgb(20, 45, 55)'],
      ['Strix', 'rgb(247, 217, 104)', 'rgb(20, 45, 55)'],
      ['Aonynx', 'rgb(211, 215, 213)', 'rgb(20, 45, 55)'],
      ['Orcaella', 'rgb(242, 181, 206)', 'rgb(20, 45, 55)'],
      ['Rusa', 'rgb(47, 100, 79)', 'rgb(255, 253, 248)'],
      ['Chelonia', 'rgb(46, 79, 118)', 'rgb(255, 253, 248)'],
      ['Panthera', 'rgb(232, 135, 58)', 'rgb(20, 45, 55)'],
    ];
    for (const [name, fill, text] of expected) {
      const choice = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(choice.style.backgroundColor).toBe(fill);
      expect(choice.style.color).toBe(text);
    }
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(7);
  });

  it('preselects nothing and keeps confirmation disabled until a house is chosen', () => {
    show();

    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(confirmButton()).toHaveProperty('disabled', true);
  });

  it('names the chosen house on the confirmation control and marks the choice pressed', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));

    expect(screen.getByRole('button', { name: /^Rusa/ }).getAttribute('aria-pressed')).toBe('true');
    expect(confirmButton()).toHaveProperty('disabled', false);
    expect(confirmButton().textContent).toBe('Confirm Rusa');
    // Colour is not the only signal: a check shows in the choice itself.
    expect(screen.getByRole('button', { name: /^Rusa/ }).textContent).toContain('✓');
  });

  it('requires two deliberate taps: choosing does not save', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Chelonia/ }));

    expect(mocks.chooseHouse).not.toHaveBeenCalled();
  });

  it('shows a busy label and blocks a repeat submission while saving', async () => {
    let release: (value: { status: string; house: string }) => void = () => {};
    mocks.chooseHouse.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(confirmButton().textContent).toBe('Saving...'));
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    expect(mocks.chooseHouse).toHaveBeenCalledTimes(1);

    release({ status: 'saved', house: 'rusa' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('hands a successful save back to its owner', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Panthera/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.chooseHouse).toHaveBeenCalledWith('panthera');
    expect(onDefer).not.toHaveBeenCalled();
  });

  it('keeps the choice and restores the control after an ordinary failure', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'failed' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Strix/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText('We couldn’t save your house. Try again.')).toBeTruthy());
    expect(screen.getByRole('button', { name: /^Strix/ }).getAttribute('aria-pressed')).toBe('true');
    expect(confirmButton().textContent).toBe('Confirm Strix');
    expect(confirmButton()).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Choose later' })).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('explains an expired sign-in and offers a route back, without retrying the write', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'expired' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Manis/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText(/sign-in expired/i)).toBeTruthy());
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByTestId('house-confirm')).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('switches to the stored house when the database says it was already set', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'already', house: 'chelonia' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText('Your house is already set to Chelonia.')).toBeTruthy());
    // Retry controls disappear; only Done closes the resolved state.
    expect(screen.queryByTestId('house-confirm')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Rusa/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('announces failures and race outcomes through a live region', async () => {
    mocks.chooseHouse.mockResolvedValue({ status: 'failed' });
    show();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(confirmButton());

    await waitFor(() => {
      const live = document.querySelector('[aria-live]');
      expect(live?.textContent).toContain('We couldn’t save your house. Try again.');
    });
  });

  it('defers on Choose later, on Escape, and on a backdrop tap', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));
    expect(onDefer).toHaveBeenCalledTimes(1);

    cleanup();
    show();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDefer).toHaveBeenCalledTimes(2);

    cleanup();
    show();
    fireEvent.mouseDown(screen.getByTestId('house-backdrop'));
    expect(onDefer).toHaveBeenCalledTimes(3);
  });

  it('never treats a tap inside the dialog as a backdrop tap', () => {
    show();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Choose your house' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: /^Rusa/ }));

    expect(onDefer).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog on open and restores it on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const view = show();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);

    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab inside the dialog', () => {
    show();
    const dialog = screen.getByRole('dialog');
    // Same selector the component uses: a disabled Confirm is not in its trap, so a test that
    // counted it would compare two different lists.
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
    const last = focusable[focusable.length - 1];

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(focusable[0]);

    focusable[0].focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
