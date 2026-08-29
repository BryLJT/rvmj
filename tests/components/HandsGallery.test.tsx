import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HandsGallery } from '../../src/app/hands/HandsGallery';

const photo = (over: Partial<Parameters<typeof HandsGallery>[0]['photos'][number]> = {}) => ({
  claimId: 'c1',
  url: 'https://signed.example/a.webp',
  playerName: 'Bryan',
  handNames: ['Thirteen Wonders'],
  playedAt: '2026-08-20T14:00:00.000Z',
  ...over,
});

afterEach(cleanup);

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

  /**
   * The panel is gone. A tile is a link to the win's own page, which is where a photo is now
   * viewed, added and removed — one screen, one permission rule.
   */
  it('links a tile to that win, telling the page to send them back here', () => {
    render(<HandsGallery photos={[photo()]} returnQuery="year=2026&hand=h8" />);

    const link = screen.getByRole('link', { name: 'Thirteen Wonders won by Bryan' });
    expect(link.getAttribute('href')).toBe('/hands/c1?year=2026&hand=h8&from=hands');
  });

  it('still links correctly from an archive with no filter of its own', () => {
    render(<HandsGallery photos={[photo()]} />);

    expect(screen.getByRole('link', { name: 'Thirteen Wonders won by Bryan' }).getAttribute('href'))
      .toBe('/hands/c1?from=hands');
  });

  it('keeps a multi-label win as one card while naming every label and winner', () => {
    render(<HandsGallery photos={[photo({ handNames: ['All Pungs', 'Pure Suit'] })]} />);

    const link = screen.getByRole('link', { name: 'All Pungs, Pure Suit won by Bryan' });
    expect(link).toBeDefined();
    // One physical win is one card, however many labels it carries.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('All Pungs')).toBeDefined();
    expect(screen.getByText('Pure Suit')).toBeDefined();
  });

  /**
   * The archive can no longer change anything. Every control that used to live here is on the win
   * page, so the rule about who may delete a photo exists in exactly one place.
   */
  it('offers no photo controls at all', () => {
    render(<HandsGallery photos={[photo(), photo({ claimId: 'c2' })]} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('Remove photo')).toBeNull();
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
