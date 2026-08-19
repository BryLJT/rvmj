import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Loading from '../../src/app/loading';
import ErrorPage from '../../src/app/error';
import NotFound from '../../src/app/not-found';

afterEach(cleanup);

it('renders a branded loading status', () => {
  render(<Loading />);
  expect(screen.getByRole('status').textContent).toContain('Loading the table…');
});

it('lets a failed route retry in place', () => {
  const retry = vi.fn();
  const error = new Error('network down');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    render(<ErrorPage error={error} retry={retry} />);
    expect(consoleError).toHaveBeenCalledWith(error);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    consoleError.mockRestore();
  }
});

it('gives an unknown route a way home', () => {
  render(<NotFound />);
  expect(screen.getByRole('link', { name: 'Back to the leaderboard' }).getAttribute('href')).toBe('/');
});
