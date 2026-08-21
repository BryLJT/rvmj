import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ chooseHouse: vi.fn(), refresh: vi.fn() }));
vi.mock('../../src/lib/actions/house', () => ({ chooseHouse: mocks.chooseHouse }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { ChooseHouseAction } from '../../src/components/ChooseHouseAction';
import { HousePromptProvider } from '../../src/components/HousePromptProvider';

const at = (url: string) => window.history.replaceState({}, '', url);
const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

const mount = (withAction = false) => render(
  <HousePromptProvider>
    <p>destination</p>
    {withAction ? <ChooseHouseAction /> : null}
  </HousePromptProvider>,
);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.chooseHouse.mockResolvedValue({ status: 'saved', house: 'rusa' });
  at('/');
});

describe('house prompt host', () => {
  it('opens over the destination when the marker is present', () => {
    at('/?houseSetup=1');
    mount();

    expect(screen.getByRole('dialog')).toBeTruthy();
    // The destination is still rendered underneath, not replaced.
    expect(screen.getByText('destination')).toBeTruthy();
  });

  it('stays shut without the marker', () => {
    mount();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a forged marker opens nothing more than the interface', () => {
    at('/?houseSetup=1');
    mount();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(mocks.chooseHouse).not.toHaveBeenCalled();
  });

  it('deferral closes the modal and removes only the marker', () => {
    at('/?board=skill&houseSetup=1#top');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(here()).toBe('/?board=skill#top');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('Escape and the backdrop defer the same way', () => {
    at('/?houseSetup=1');
    mount();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(here()).toBe('/');

    cleanup();
    at('/?houseSetup=1');
    mount();
    fireEvent.mouseDown(screen.getByTestId('house-backdrop'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(here()).toBe('/');
  });

  /**
   * Deferral is not an opt-out, so it must leave no trace the app could later read back as one.
   * Compared before and against after rather than asserted empty: this jsdom hands out a stub
   * localStorage with no `length`, and "unchanged by this action" is the claim anyway.
   */
  it('writes no deferral preference anywhere', () => {
    const asRecord = (store: Storage) => Object.entries(store as unknown as Record<string, unknown>);
    const snapshot = () => JSON.stringify({
      cookie: document.cookie,
      local: asRecord(window.localStorage),
      session: asRecord(window.sessionStorage),
    });

    at('/?houseSetup=1');
    const before = snapshot();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));

    expect(snapshot()).toBe(before);
    expect(snapshot()).not.toMatch(/house/i);
  });

  it('the homepage action opens the same modal with no marker in sight', () => {
    mount(true);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Choose your house' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(here()).toBe('/');
  });

  it('a save closes the modal, clears the marker, and refreshes server data', async () => {
    at('/?houseSetup=1');
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Rusa/ }));
    fireEvent.click(screen.getByTestId('house-confirm'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(here()).toBe('/');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the launcher after the modal closes', async () => {
    mount(true);
    const launcher = screen.getByRole('button', { name: 'Choose your house' });
    launcher.focus();
    fireEvent.click(launcher);
    fireEvent.click(screen.getByRole('button', { name: 'Choose later' }));

    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });
});
