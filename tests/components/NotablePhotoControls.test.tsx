import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  addNotablePhoto: vi.fn(),
  removeNotablePhoto: vi.fn(),
  preparePhoto: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('../../src/lib/actions/game', () => ({
  addNotablePhoto: mocks.addNotablePhoto,
  removeNotablePhoto: mocks.removeNotablePhoto,
}));
vi.mock('../../src/lib/image', () => ({ preparePhoto: mocks.preparePhoto }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { NotablePhotoControls } from '../../src/components/NotablePhotoControls';

const CLAIM_ID = '3f1a5e0c-0d7b-4a2e-9f1b-7c2d8e4a6b90';

/** jsdom will not populate `files` from a change event, so it is defined directly. */
function attach(labelText: string) {
  const input = screen.getByLabelText(labelText) as HTMLInputElement;
  const file = new File([new Uint8Array([9])], 'hand.heic', { type: 'image/heic' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  Object.defineProperty(input, 'value', { value: 'C:\\fakepath\\hand.heic', writable: true, configurable: true });
  fireEvent.change(input);
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preparePhoto.mockResolvedValue(new Blob(['prepared']));
  mocks.addNotablePhoto.mockResolvedValue({});
  mocks.removeNotablePhoto.mockResolvedValue({});
  // jsdom implements neither, and the component holds an object URL for the preview.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe('attaching a photo', () => {
  /**
   * Two inputs, not one. On iOS a single input with `capture` set opens the camera and offers no
   * route to the library at all — the complaint that produced the same split in the logger.
   */
  it('offers the camera and the library as separate controls', () => {
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto={false} addedByMe={false} />);

    expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose from library' })).toBeTruthy();
    expect(screen.getByLabelText('Take photo using camera').getAttribute('capture')).toBe('environment');
    expect(screen.getByLabelText('Choose photo from library').getAttribute('capture')).toBeNull();
  });

  it('prepares the chosen file before anything crosses the network', async () => {
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto={false} addedByMe={false} />);

    attach('Choose photo from library');

    await waitFor(() => expect(mocks.preparePhoto).toHaveBeenCalledTimes(1));
    expect(mocks.addNotablePhoto).not.toHaveBeenCalled();
    expect(await screen.findByRole('img', { name: 'The photo you chose' })).toBeTruthy();
  });

  it('saves the prepared photo, not the original file', async () => {
    const prepared = new Blob(['prepared']);
    mocks.preparePhoto.mockResolvedValue(prepared);
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto={false} addedByMe={false} />);

    attach('Choose photo from library');
    await screen.findByRole('button', { name: 'Save photo' });
    click('Save photo');

    await waitFor(() => expect(mocks.addNotablePhoto).toHaveBeenCalledWith(CLAIM_ID, prepared));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  /** Retrying should not mean finding the photo again on a phone at a table. */
  it('keeps the chosen photo when saving fails', async () => {
    mocks.addNotablePhoto.mockResolvedValue({ error: 'this win already has a photo' });
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto={false} addedByMe={false} />);

    attach('Choose photo from library');
    await screen.findByRole('button', { name: 'Save photo' });
    click('Save photo');

    expect(await screen.findByText('this win already has a photo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save photo' })).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('reports a photo it could not read and offers the pickers again', async () => {
    mocks.preparePhoto.mockRejectedValue(new Error('Could not read that photo. Try another photo.'));
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto={false} addedByMe={false} />);

    attach('Choose photo from library');

    expect(await screen.findByText('Could not read that photo. Try another photo.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
  });
});

describe('removing a photo', () => {
  it('removes your own photo on a single tap', async () => {
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto addedByMe />);

    click('Remove photo');

    await waitFor(() => expect(mocks.removeNotablePhoto).toHaveBeenCalledWith(CLAIM_ID));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  /**
   * Anyone who played may remove any photo of that game, and removal deletes the object. Somebody
   * else's photo is not yours to discard on a single tap.
   */
  it('asks before removing a photo somebody else added, and does nothing until confirmed', async () => {
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto addedByMe={false} />);

    click('Remove photo');

    expect(mocks.removeNotablePhoto).not.toHaveBeenCalled();
    expect(screen.getByText(/Somebody else added this photo/)).toBeTruthy();

    click('Yes, remove it');
    await waitFor(() => expect(mocks.removeNotablePhoto).toHaveBeenCalledWith(CLAIM_ID));
  });

  it('lets you back out of removing somebody else’s photo', async () => {
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto addedByMe={false} />);

    click('Remove photo');
    click('Keep it');

    expect(mocks.removeNotablePhoto).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();
  });

  it('reports a failed removal and leaves the control in place', async () => {
    mocks.removeNotablePhoto.mockResolvedValue({ error: 'you did not play in this game' });
    render(<NotablePhotoControls claimId={CLAIM_ID} hasPhoto addedByMe />);

    click('Remove photo');

    expect(await screen.findByText('you did not play in this game')).toBeTruthy();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
