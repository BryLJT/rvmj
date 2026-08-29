import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HandsGallery } from '../../src/app/hands/HandsGallery';
import { removeNotablePhoto } from '../../src/lib/actions/game';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('../../src/lib/actions/game', () => ({ removeNotablePhoto: vi.fn(async () => ({})) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

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
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(removeNotablePhoto).mockResolvedValue({});
});

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

    // The dialog still names itself in full for a screen reader — asserted above — but it does so
    // from the PANEL, so the visible heading no longer repeats the winner that the eyebrow
    // directly above it already gives. Three statements of the same fact became one each.
    expect(within(panel).getByRole('heading', { level: 2 }).textContent).toBe('All Pungs, Pure Suit');
    expect(within(panel).getAllByText('Bryan')).toHaveLength(1);
  });

  /**
   * Found by ROLE and accessible name, not by reading the aria-label attribute: ARIA prohibits
   * naming the implicit `generic` role, so an aria-label on a bare div is dropped by assistive
   * tech while `getByLabelText` would still match it and report the suite green.
   */
  it('names the label list to assistive tech, not just in the markup', () => {
    render(<HandsGallery photos={[photo({ handNames: ['All Pungs', 'Pure Suit'] })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'All Pungs, Pure Suit won by Bryan' }));

    const labels = screen.getByRole('group', { name: 'Hand types' });
    expect([...labels.children].map((label) => label.textContent)).toEqual(['All Pungs', 'Pure Suit']);
  });

  it('offers no remove control on someone else’s photo', () => {
    render(<HandsGallery photos={[photo({ mine: false })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });

  it('removes a photo the viewer logged, closes its panel, and refreshes once', async () => {
    render(<HandsGallery photos={[photo({ mine: true })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove photo' })); });

    expect(vi.mocked(removeNotablePhoto)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(removeNotablePhoto)).toHaveBeenCalledWith('c1');
    expect(screen.queryByRole('dialog', { name: 'Thirteen Wonders won by Bryan' })).toBeNull();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed removal open, visible, unrefreshed, and ready to retry', async () => {
    vi.mocked(removeNotablePhoto).mockResolvedValue({ error: 'Photo could not be removed.' });
    render(<HandsGallery photos={[photo({ mine: true })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove photo' })); });

    const panel = screen.getByRole('dialog', { name: 'Thirteen Wonders won by Bryan' });
    expect(within(panel).getByRole('img', { name: 'Thirteen Wonders won by Bryan' })).toBeDefined();
    expect(screen.getByRole('alert').textContent).toContain('Photo could not be removed.');
    expect(screen.getByRole('button', { name: 'Remove photo' }).hasAttribute('disabled')).toBe(false);
    expect(mocks.refresh).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove photo' })); });

    expect(vi.mocked(removeNotablePhoto)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(removeNotablePhoto)).toHaveBeenNthCalledWith(2, 'c1');
    expect(screen.getByRole('dialog', { name: 'Thirteen Wonders won by Bryan' })).toBeDefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe('HandsGallery empty states', () => {
  it('distinguishes an empty filter result from an empty archive', () => {
    render(<HandsGallery photos={[]} filtered />);
    expect(screen.getByText(/No photos of these hand types yet/i)).toBeTruthy();
    expect(screen.queryByText(/No photographed hands yet/i)).toBeNull();
  });

  it('still says the archive is empty when nothing was filtered', () => {
    render(<HandsGallery photos={[]} />);
    expect(screen.getByText(/No photographed hands yet/i)).toBeTruthy();
  });
});
