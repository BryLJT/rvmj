import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotableLogger } from '../../src/app/game/[id]/NotableLogger';
import { logNotable } from '../../src/lib/actions/game';
import { preparePhoto } from '../../src/lib/image';

vi.mock('../../src/lib/actions/game', () => ({
  logNotable: vi.fn(async () => ({})),
}));

vi.mock('../../src/lib/image', () => ({
  MAX_UPLOAD_BYTES: 2 * 1024 * 1024,
  preparePhoto: vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/webp' })),
}));

const NativeURL = URL;
const createObjectURL = vi.fn<() => string>();
const revokeObjectURL = vi.fn<(url: string) => void>();
let previewNumber = 1;

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
  rarity: index < 4 ? 'uncommon' as const : index < 8 ? 'rare' as const : 'legendary' as const,
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

function chooseNotable(handIds = ['h1']) {
  fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
  handIds.forEach((id) => fireEvent.click(screen.getByRole('checkbox', {
    name: notableHands.find((hand) => hand.id === id)?.name,
  })));
}

function attachPhoto(input: HTMLInputElement) {
  const file = new File([new Uint8Array([9])], 'hand.heic', { type: 'image/heic' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  Object.defineProperty(input, 'value', {
    value: 'C:\\fakepath\\hand.heic',
    writable: true,
    configurable: true,
  });
  fireEvent.change(input);
  return input;
}

function attachCameraPhoto() {
  return attachPhoto(screen.getByLabelText('Take photo using camera') as HTMLInputElement);
}

function attachLibraryPhoto() {
  return attachPhoto(screen.getByLabelText('Choose photo from library') as HTMLInputElement);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(logNotable).mockResolvedValue({});
  previewNumber = 1;
  createObjectURL.mockImplementation(() => `blob:preview-${previewNumber++}`);
  class TestURL extends NativeURL {}
  Object.assign(TestURL, { createObjectURL, revokeObjectURL });
  vi.stubGlobal('URL', TestURL);
});

describe('NotableLogger', () => {
  it('shows all hand types as grouped checkboxes in the named logger', () => {
    renderLogger();

    expect(screen.getByRole('dialog', { name: 'Log notable win' })).toBeDefined();
    expect(screen.getByText('Who won it?')).toBeDefined();
    expect(screen.getAllByRole('checkbox')).toHaveLength(12);
    notableHands.forEach((hand) => expect(screen.getByRole('checkbox', { name: hand.name })).toBeDefined());
    const uncommon = screen.getByText('Uncommon');
    const rare = screen.getByText('Rare');
    const legendary = screen.getByText('Legendary');
    expect(uncommon.compareDocumentPosition(rare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rare.compareDocumentPosition(legendary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires one winner and at least one hand type, including several hand types', () => {
    renderLogger();

    fireEvent.click(screen.getByRole('button', { name: 'Bryan' }));
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Thirteen Wonders' }));
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notable hand 8' }));
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('deselects only the clicked hand type without changing the winner or other selections', () => {
    renderLogger();
    chooseNotable(['h1', 'h8']);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Thirteen Wonders' }));

    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('checkbox', { name: 'Thirteen Wonders' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Notable hand 8' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks duplicate activation before rerender and closes exactly once after success', async () => {
    let release!: () => void;
    vi.mocked(logNotable).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({});
    }));
    const onClose = renderLogger();
    chooseNotable(['h1', 'h8']);
    const action = screen.getByRole('button', { name: 'Log notable win' });

    act(() => {
      action.click();
      action.click();
    });

    expect(logNotable).toHaveBeenCalledTimes(1);
    // The photo argument is always passed, so the no-photo call carries an explicit undefined.
    expect(logNotable).toHaveBeenCalledWith('g1', 'p2', ['h1', 'h8'], undefined);
    expect((screen.getByRole('button', { name: 'Logging…' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => release());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the exact selected hand types and restores the action after an action failure', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'hand no longer available' });
    renderLogger();
    chooseNotable(['h1', 'h8']);

    fireEvent.click(screen.getByRole('button', { name: 'Log notable win' }));

    expect((await screen.findByRole('alert')).textContent).toContain('hand no longer available');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('checkbox', { name: 'Thirteen Wonders' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Notable hand 8' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the exact selected hand types and restores the action after a rejected request', async () => {
    vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
    renderLogger();
    chooseNotable(['h1', 'h8']);

    fireEvent.click(screen.getByRole('button', { name: 'Log notable win' }));

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('checkbox', { name: 'Thirteen Wonders' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Notable hand 8' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('NotableLogger photo capture', () => {
  it('offers separate rear-camera and photo-library sources', () => {
    renderLogger();

    const camera = screen.getByLabelText('Take photo using camera') as HTMLInputElement;
    const library = screen.getByLabelText('Choose photo from library') as HTMLInputElement;
    expect(camera.getAttribute('accept')).toBe('image/*');
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(library.getAttribute('accept')).toBe('image/*');
    expect(library.hasAttribute('capture')).toBe(false);

    const cameraClick = vi.spyOn(camera, 'click');
    const libraryClick = vi.spyOn(library, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose from library' }));
    expect(cameraClick).toHaveBeenCalledOnce();
    expect(libraryClick).toHaveBeenCalledOnce();
  });

  it('logs without a photo when none was taken', async () => {
    renderLogger();
    chooseNotable();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    expect(vi.mocked(logNotable)).toHaveBeenCalledWith('g1', 'p2', ['h1'], undefined);
  });

  it('shrinks the chosen photo and sends it with the claim', async () => {
    renderLogger();
    chooseNotable();
    await act(async () => { attachLibraryPhoto(); });

    expect(vi.mocked(preparePhoto)).toHaveBeenCalledTimes(1);
    expect(screen.getByAltText('Photo of the tiles you are about to log')).toBeDefined();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    const sent = vi.mocked(logNotable).mock.calls[0][3];
    expect(sent).toBeInstanceOf(Blob);
  });

  it('blocks logging while the chosen photo is being prepared', async () => {
    let release!: (blob: Blob) => void;
    vi.mocked(preparePhoto).mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve;
    }));
    renderLogger();
    chooseNotable();

    attachLibraryPhoto();

    expect(screen.getByText('Preparing photo…')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Log notable win' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release(new Blob([new Uint8Array([1])], { type: 'image/jpeg' })));
  });

  it('resets the source input after reading so the same file can be chosen again', async () => {
    renderLogger();
    let input!: HTMLInputElement;
    await act(async () => { input = attachLibraryPhoto(); });
    expect(input.value).toBe('');
  });

  it('removes a prepared photo and submits no photo', async () => {
    renderLogger();
    chooseNotable();
    await act(async () => { attachLibraryPhoto(); });

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    expect(vi.mocked(logNotable)).toHaveBeenLastCalledWith('g1', 'p2', ['h1'], undefined);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });

  // The point of the whole mitigation: a dead upload must not cost the claim.
  it('keeps the exact selected hand types and offers an escape when the upload fails', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'Could not upload the photo.', photoFailed: true });
    renderLogger();
    chooseNotable(['h1', 'h8']);
    await act(async () => { attachLibraryPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    expect(screen.getByText('Could not upload the photo.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('checkbox', { name: 'Thirteen Wonders' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Notable hand 8' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Log it without the photo' })).toBeDefined();
  });

  it('submits the identical claim with no photo when the escape is taken', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'Could not upload the photo.', photoFailed: true });
    const onClose = renderLogger();
    chooseNotable(['h1', 'h8']);
    await act(async () => { attachLibraryPhoto(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log it without the photo' })); });

    expect(vi.mocked(logNotable)).toHaveBeenLastCalledWith('g1', 'p2', ['h1', 'h8'], undefined);
    expect(onClose).toHaveBeenCalled();
  });

  // Spec §8 names the dropped connection as the risk the escape exists for, and a dropped
  // connection THROWS rather than returning {photoFailed}. The returned path is the less
  // likely half; this is the half that happens at a mahjong table.
  it('offers an escape when the request throws with a photo attached', async () => {
    vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
    renderLogger();
    chooseNotable(['h1', 'h8']);
    await act(async () => { attachLibraryPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(screen.getByRole('button', { name: 'Bryan' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('checkbox', { name: 'Thirteen Wonders' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Notable hand 8' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Log it without the photo' })).toBeDefined();
  });

  // A throw with nothing attached is not a photo failure: the escape would re-send the very
  // same claim over the very same connection.
  it('offers no escape when the request throws with no photo attached', async () => {
    vi.mocked(logNotable).mockRejectedValueOnce(new Error('network down'));
    renderLogger();
    chooseNotable();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    expect((await screen.findByRole('alert')).textContent).toContain('network down');
    expect(screen.queryByRole('button', { name: 'Log it without the photo' })).toBeNull();
  });

  // A refused CLAIM would be refused again without the photo, so the escape must stay hidden.
  it('offers no escape when the claim itself was refused', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({ error: 'game is not an active chip game' });
    renderLogger();
    chooseNotable();
    await act(async () => { attachLibraryPhoto(); });

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });

    expect(screen.queryByRole('button', { name: 'Log it without the photo' })).toBeNull();
  });

  it('replacing a failed photo hides the stale no-photo escape', async () => {
    vi.mocked(logNotable).mockResolvedValueOnce({
      error: 'Could not upload the photo.',
      photoFailed: true,
    });
    renderLogger();
    chooseNotable();
    await act(async () => { attachLibraryPhoto(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log notable win' })); });
    expect(screen.getByRole('button', { name: 'Log it without the photo' })).toBeDefined();

    await act(async () => { attachCameraPhoto(); });

    expect(screen.queryByRole('button', { name: 'Log it without the photo' })).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });
});
