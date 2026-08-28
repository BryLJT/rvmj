import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HandsGallery } from '../../src/app/hands/HandsGallery';
import { removeNotablePhoto } from '../../src/lib/actions/game';

vi.mock('../../src/lib/actions/game', () => ({ removeNotablePhoto: vi.fn(async () => ({})) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const photo = (over: Partial<Parameters<typeof HandsGallery>[0]['photos'][number]> = {}) => ({
  claimId: 'c1',
  url: 'https://signed.example/a.webp',
  playerName: 'Bryan',
  handNames: ['Thirteen Wonders'],
  playedAt: '2026-08-20T14:00:00.000Z',
  mine: false,
  ...over,
});

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

describe('HandsGallery', () => {
  it('says so plainly when nothing has been photographed', () => {
    render(<HandsGallery photos={[]} />);
    expect(screen.getByText('No photographed hands yet.')).toBeDefined();
  });

  it('groups photos under the night they were played', () => {
    render(<HandsGallery photos={[photo(), photo({ claimId: 'c2', playedAt: '2026-08-14T10:00:00.000Z' })]} />);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });

  // The grouping key is also a React key, so a server that groups differently from the phone
  // does not merely print the wrong word — it emits a different number of <section>s, and the
  // hydration mismatch is structural. Vercel renders in UTC; the table sits in UTC+8. Pinned
  // under UTC because a Singapore dev machine cannot tell the two implementations apart.
  it('groups an after-midnight hand under its Singapore night, not the server’s', () => {
    const realTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      // 01:00 on Friday in Singapore, still 17:00 on Thursday in UTC.
      render(<HandsGallery photos={[photo({ playedAt: '2026-08-20T17:00:00.000Z' })]} />);
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Friday, 21 August 2026');
    } finally {
      if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
    }
  });

  it('opens a photo full screen when tapped', () => {
    render(<HandsGallery photos={[photo()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    expect(screen.getByRole('dialog', { name: 'Thirteen Wonders won by Bryan' })).toBeDefined();
  });

  it('keeps a multi-label win as one card while naming every label and winner', () => {
    render(<HandsGallery photos={[photo({ handNames: ['All Pungs', 'Pure Suit'] })]} />);

    expect(screen.getAllByRole('button', { name: 'All Pungs, Pure Suit won by Bryan' })).toHaveLength(1);
    const card = screen.getByRole('button', { name: 'All Pungs, Pure Suit won by Bryan' });
    expect(within(card).getByText('All Pungs')).toBeDefined();
    expect(within(card).getByText('Pure Suit')).toBeDefined();

    fireEvent.click(card);

    const panel = screen.getByRole('dialog', { name: 'All Pungs, Pure Suit won by Bryan' });
    expect(within(panel).getByText('All Pungs')).toBeDefined();
    expect(within(panel).getByText('Pure Suit')).toBeDefined();
    expect(within(panel).getByRole('img', { name: 'All Pungs, Pure Suit won by Bryan' })).toBeDefined();
  });

  it('offers no remove control on someone else’s photo', () => {
    render(<HandsGallery photos={[photo({ mine: false })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });

  it('removes a photo the viewer logged', async () => {
    render(<HandsGallery photos={[photo({ mine: true })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove photo' })); });

    expect(vi.mocked(removeNotablePhoto)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(removeNotablePhoto)).toHaveBeenCalledWith('c1');
  });
});
