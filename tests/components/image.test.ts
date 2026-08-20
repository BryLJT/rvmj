import { describe, expect, it } from 'vitest';
import { fitWithin, MAX_EDGE } from '../../src/lib/image';

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

import { afterEach, beforeEach, vi } from 'vitest';
import { downscaleToWebp, MAX_UPLOAD_BYTES } from '../../src/lib/image';

const drawImage = vi.fn();
let toBlobResult: Blob | null;

beforeEach(() => {
  toBlobResult = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4032, height: 3024, close: vi.fn() })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
    cb(toBlobResult);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  drawImage.mockReset();
});

describe('downscaleToWebp', () => {
  it('draws the image at the fitted size and returns a WebP blob', async () => {
    const blob = await downscaleToWebp(new File([new Uint8Array([9])], 'hand.heic', { type: 'image/heic' }));

    expect(blob.type).toBe('image/webp');
    const [, , , drawnWidth, drawnHeight] = drawImage.mock.calls[0];
    expect(drawnWidth).toBe(1600);
    expect(drawnHeight).toBe(1200);
  });

  it('rejects when the browser cannot encode the image', async () => {
    toBlobResult = null;
    await expect(downscaleToWebp(new File([new Uint8Array([9])], 'x.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow('Could not read that photo');
  });

  it('rejects a re-encoded photo that is still over the upload limit', async () => {
    toBlobResult = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/webp' });
    await expect(downscaleToWebp(new File([new Uint8Array([9])], 'x.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow('still too large');
  });
});
