import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HandsGallery } from '../../src/app/hands/HandsGallery';
import { removeNotablePhoto } from '../../src/lib/actions/game';

vi.mock('../../src/lib/actions/game', () => ({ removeNotablePhoto: vi.fn(async () => ({})) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const photo = (over: Partial<Parameters<typeof HandsGallery>[0]['photos'][number]> = {}) => ({
  claimId: 'c1',
  url: 'https://signed.example/a.webp',
  playerName: 'Bryan',
  handName: 'Thirteen Wonders',
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

  it('opens a photo full screen when tapped', () => {
    render(<HandsGallery photos={[photo()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Thirteen Wonders won by Bryan' }));

    expect(screen.getByRole('dialog', { name: 'Thirteen Wonders' })).toBeDefined();
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

    expect(vi.mocked(removeNotablePhoto)).toHaveBeenCalledWith('c1');
  });
});
