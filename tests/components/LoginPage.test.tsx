import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from '../../src/app/login/page';

const signInWithOAuth = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: (key: string) => key === 'next' ? '/t/east-secret' : null,
  }),
}));

vi.mock('../../src/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOAuth } }),
}));

afterEach(cleanup);
beforeEach(() => {
  signInWithOAuth.mockReset();
});

it('preserves the table return address and blocks duplicate sign-in taps', async () => {
  let release!: (value: { error: null }) => void;
  signInWithOAuth.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  render(<LoginPage />);
  const button = screen.getByRole('button', { name: 'Sign in with Google' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(signInWithOAuth).toHaveBeenCalledTimes(1);
  expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/t/east-secret')}` },
  });
  expect((screen.getByRole('button', { name: 'Opening Google…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release({ error: null }));
});

it('shows an OAuth failure inline and restores the action', async () => {
  signInWithOAuth.mockResolvedValueOnce({ error: { message: 'provider unavailable' } });
  render(<LoginPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
  expect((await screen.findByRole('alert')).textContent).toContain('provider unavailable');
  expect((screen.getByRole('button', { name: 'Sign in with Google' }) as HTMLButtonElement).disabled).toBe(false);
});
