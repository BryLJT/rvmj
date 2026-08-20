import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotableLogger } from '../../src/app/game/[id]/NotableLogger';
import { logNotable } from '../../src/lib/actions/game';
import { downscaleToWebp } from '../../src/lib/image';

vi.mock('../../src/lib/actions/game', () => ({
  logNotable: vi.fn(async () => ({})),
}));

vi.mock('../../src/lib/image', () => ({
  MAX_UPLOAD_BYTES: 2 * 1024 * 1024,
  downscaleToWebp: vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/webp' })),
}));

const players = [
  { playerId: 'p1', seat: 'E' as const, name: 'Ah Seng' },
  { playerId: 'p2', seat: 'S' as const, name: 'Bryan' },
  { playerId: 'p3', seat: 'W' as const, name: 'Ah Beng' },
  { playerId: 'p4', seat: 'N' as const, name: 'Ah Huat' },
];

const notableHands = Array.from({ length: 12 }, (_, index) => ({
  id: `h${index + 1}`,
  name: index === 0 ? 'Thirteen Wonders' : `Notable hand ${index + 1}`,
  local_name: index === 0 ? '十三幺' : null,
}));

function renderLogger(onClose = vi.fn()) {
  render(
    <NotableLogger
      players={players}
      notableHands={notableHands}
      gameId="g1"
      onClose={onClose}
    />,
  );
  return onClose;
}

function chooseNotable() {
  fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
  fireEvent.change(screen.getByLabelText('Notable hand'), { target: { value: 'h1' } });
}

function attachPhoto() {
  const input = screen.getByLabelText('Photo of the tiles') as HTMLInputElement;
  const file = new File([new Uint8Array([9])], 'hand.heic', { type: 'image/heic' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logNotable).mockResolvedValue({});
});

describe('NotableLogger', () => {
  it('starts with a disabled action in a named dialog with labelled choices', () => {
    renderLogger();

    expect(screen.getByRole('dialog', { name: 'Log notable hand' })).toBeDefined();
    expect(screen.getByText('Who won it?')).toBeDefined();
    expect(screen.getByLabelText('Notable hand')).toBeDefined();
    expect(screen.getAllByRole('option')).toHaveLength(13);
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the chosen player as pressed and enables the action only after both choices exist', () => {
    renderLogger();

    fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Notable hand'), { target: { value: 'h1' } });
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks duplicate activation before rerender and closes exactly once after success', async () => {
    let release!: () => void;
    vi.mocked(logNotable).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({});
    }));
    const onClose = renderLogger();
    chooseNotable();
    const action = screen.getByRole('button', { name: 'Log notable hand' });

    act(() => {
      action.click();
      action.click();
    });

    expect(logNotable).toHaveBeenCalledTimes(1);
    // The photo argument is always passed, so the no-photo call carries an explicit undefined.
    expect(logNotable).toHaveBeenCalledWith('g1', 'p2', 'h1', undefined);
    expect((screen.getByRole('button', { name: 'Logging…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => release());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps both choices and restores the action after an action failure', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'hand no longer available' });
    renderLogger();
    chooseNotable();

    fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' }));

    expect((await screen.findByRole('alert')).textContent).toContain('hand no longer available');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps both choices and restores the action after a rejected request', async () => {
    vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
    renderLogger();
    chooseNotable();

    fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' }));

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
    expect((screen.getByRole('button', { name: 'Log notable hand' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('NotableLogger photo capture', () => {
  it('logs without a photo when none was taken', async () => {
    renderLogger();
    chooseNotable();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect(vi.mocked(logNotable)).toHaveBeenCalledWith('g1', 'p2', 'h1', undefined);
  });

  it('shrinks the chosen photo and sends it with the claim', async () => {
    renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });

    expect(vi.mocked(downscaleToWebp)).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('Photo of the tiles you are about to log')).toBeDefined();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    const sent = vi.mocked(logNotable).mock.calls[0][3];
    expect(sent).toBeInstanceOf(Blob);
  });

  // The point of the whole mitigation: a dead upload must not cost the claim.
  it('keeps both choices and offers an escape when the upload fails', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'Could not upload the photo.', photoFailed: true });
    renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect(screen.getByText('Could not upload the photo.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
    expect(screen.getByRole('button', { name: 'Log it without the photo' })).toBeDefined();
  });

  it('submits the identical claim with no photo when the escape is taken', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'Could not upload the photo.', photoFailed: true });
    const onClose = renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log it without the photo' })); });

    expect(vi.mocked(logNotable)).toHaveBeenLastCalledWith('g1', 'p2', 'h1', undefined);
    expect(onClose).toHaveBeenCalled();
  });

  // Spec §8 names the dropped connection as the risk the escape exists for, and a dropped
  // connection THROWS rather than returning {photoFailed}. The returned path is the less
  // likely half; this is the half that happens at a mahjong table.
  it('offers an escape when the request throws with a photo attached', async () => {
    vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
    renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Notable hand') as HTMLSelectElement).value).toBe('h1');
    expect(screen.getByRole('button', { name: 'Log it without the photo' })).toBeDefined();
  });

  // A throw with nothing attached is not a photo failure: the escape would re-send the very
  // same claim over the very same connection.
  it('offers no escape when the request throws with no photo attached', async () => {
    vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
    renderLogger();
    chooseNotable();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(screen.queryByRole('button', { name: 'Log it without the photo' })).toBeNull();
  });

  // A refused CLAIM would be refused again without the photo, so the escape must stay hidden.
  it('offers no escape when the claim itself was refused', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'game is not an active chip game' });
    renderLogger();
    chooseNotable();
    await act(async () => { attachPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable hand' })); });

    expect(screen.queryByRole('button', { name: 'Log it without the photo' })).toBeNull();
  });
});
