import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Loading from '../../src/app/loading';
import ErrorPage from '../../src/app/error';
import NotFound from '../../src/app/not-found';

afterEach(cleanup);

it('renders a branded loading status', () => {
  render(<Loading />);
  expect(screen.getByRole('status').textContent).toContain('Loading the table…');
});

it('locks recovery immediately and announces its pending state', () => {
  const retry = vi.fn();
  const error = new Error('network down');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    render(<ErrorPage error={error} retry={retry} />);
    expect(consoleError).toHaveBeenCalledWith(error);
    const button = screen.getByRole('button', { name: 'Try again' });
    act(() => {
      button.click();
      button.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
    const busyButton = screen.getByRole('button', { name: 'Trying again…' }) as HTMLButtonElement;
    expect(busyButton.disabled).toBe(true);
    expect(busyButton.getAttribute('aria-busy')).toBe('true');
  } finally {
    consoleError.mockRestore();
  }
});

it('gives an unknown route a way home', () => {
  render(<NotFound />);
  expect(screen.getByRole('link', { name: 'Back to the leaderboard' }).getAttribute('href')).toBe('/');
});
