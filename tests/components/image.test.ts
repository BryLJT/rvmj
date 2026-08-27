import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitWithin, MAX_EDGE, preparePhoto } from '../../src/lib/image';

describe('fitWithin', () => {
  it('shrinks a landscape phone photo to the max edge, preserving aspect', () => {
    expect(fitWithin(4032, 3024, MAX_EDGE)).toEqual({ width: 1600, height: 1200 });
  });

  it('shrinks a portrait phone photo by its longest edge', () => {
    expect(fitWithin(3024, 4032, MAX_EDGE)).toEqual({ width: 1200, height: 1600 });
  });

  it('never upscales an image already smaller than the max edge', () => {
    expect(fitWithin(800, 600, MAX_EDGE)).toEqual({ width: 800, height: 600 });
  });

  it('handles a square image', () => {
    expect(fitWithin(2000, 2000, MAX_EDGE)).toEqual({ width: 1600, height: 1600 });
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    const { width, height } = fitWithin(8000, 3, MAX_EDGE);
    expect(width).toBe(1600);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

type EncodeCall = {
  type: string | undefined;
  quality: number | undefined;
  width: number;
  height: number;
};

const drawImage = vi.fn();
const bitmapClose = vi.fn();
const encodeCalls: EncodeCall[] = [];
let toBlobResults: Array<Blob | null>;

const smallWebp = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
const smallJpeg = () => new Blob([new Uint8Array([4, 5, 6])], { type: 'image/jpeg' });
const tooLargeWebp = () => new Blob(
  [new Uint8Array(1.5 * 1024 * 1024 + 1)],
  { type: 'image/webp' },
);

beforeEach(() => {
  encodeCalls.length = 0;
  toBlobResults = [smallWebp()];
  bitmapClose.mockReset();
  drawImage.mockReset();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: 4032,
    height: 3024,
    close: bitmapClose,
  })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ) {
    encodeCalls.push({ type, quality, width: this.width, height: this.height });
    const result = toBlobResults.shift();
    callback(result === undefined ? null : result);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preparePhoto', () => {
  it('returns verified WebP without asking for JPEG', async () => {
    const blob = await preparePhoto(new File(
      [new Uint8Array([9])],
      'hand.heic',
      { type: 'image/heic' },
    ));

    expect(blob.type).toBe('image/webp');
    expect(encodeCalls).toEqual([
      { type: 'image/webp', quality: 0.82, width: 1600, height: 1200 },
    ]);
  });

  it('discards a WebKit PNG fallback and returns verified JPEG', async () => {
    toBlobResults = [
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      smallJpeg(),
    ];

    const blob = await preparePhoto(new File([new Uint8Array([9])], 'hand.heic'));

    expect(blob.type).toBe('image/jpeg');
    expect(encodeCalls.map(({ type, quality }) => [type, quality])).toEqual([
      ['image/webp', 0.82],
      ['image/jpeg', 0.82],
    ]);
  });

  it('lowers quality before reducing dimensions', async () => {
    toBlobResults = [
      tooLargeWebp(),
      tooLargeWebp(),
      tooLargeWebp(),
      tooLargeWebp(),
      smallWebp(),
    ];

    await preparePhoto(new File([new Uint8Array([9])], 'detail.jpg'));

    expect(encodeCalls).toEqual([
      { type: 'image/webp', quality: 0.82, width: 1600, height: 1200 },
      { type: 'image/webp', quality: 0.72, width: 1600, height: 1200 },
      { type: 'image/webp', quality: 0.62, width: 1600, height: 1200 },
      { type: 'image/webp', quality: 0.52, width: 1600, height: 1200 },
      { type: 'image/webp', quality: 0.82, width: 1280, height: 960 },
    ]);
  });

  it('rejects when JPEG fallback is not actually JPEG', async () => {
    toBlobResults = [
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      null,
    ];

    await expect(preparePhoto(new File([new Uint8Array([9])], 'x.heic')))
      .rejects.toThrow('Could not read that photo');
  });

  it('stops after bounded retries', async () => {
    toBlobResults = Array.from({ length: 12 }, tooLargeWebp);

    await expect(preparePhoto(new File([new Uint8Array([9])], 'detail.jpg')))
      .rejects.toThrow('Could not shrink that photo enough');

    expect(encodeCalls).toHaveLength(12);
  });

  it('does not repeat the same dimensions for an image smaller than every retry edge', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 800,
      height: 600,
      close: bitmapClose,
    })));
    toBlobResults = Array.from({ length: 4 }, tooLargeWebp);

    await expect(preparePhoto(new File([new Uint8Array([9])], 'small-detail.jpg')))
      .rejects.toThrow('Could not shrink that photo enough');

    expect(encodeCalls).toHaveLength(4);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it('closes the decoded bitmap after success', async () => {
    await preparePhoto(new File([new Uint8Array([9])], 'hand.jpg'));
    expect(bitmapClose).toHaveBeenCalledOnce();
  });

  it('closes the decoded bitmap after an encode failure', async () => {
    toBlobResults = [
      new Blob([new Uint8Array([1])], { type: 'image/png' }),
      null,
    ];
    await expect(preparePhoto(new File([new Uint8Array([9])], 'hand.heic'))).rejects.toThrow();
    expect(bitmapClose).toHaveBeenCalledOnce();
  });
});
