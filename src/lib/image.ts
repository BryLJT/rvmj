export const MAX_EDGE = 1600;
export const WEBP_QUALITY = 0.82;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

// Shared with the server actions and the archive page. They cannot live in
// src/lib/actions/game.ts: that file is 'use server', where every export must be an async
// function, so exporting a constant from it fails the build.
export const PHOTO_BUCKET = 'notable-photos';
export const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Fit a photo inside a square of `maxEdge`, preserving aspect ratio and never upscaling.
 * Pure arithmetic, kept separate from canvas work so it can be tested exhaustively.
 */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  // A very wide panorama would otherwise round its short edge to 0 and produce an empty canvas.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Re-encode a captured photo to a bounded WebP.
 *
 * Three things fall out of this one step, and all three are load-bearing:
 *   1. a ~4MB phone photo becomes ~300KB, which is the difference between a moment and a stall
 *      on table wifi;
 *   2. iPhone HEIC becomes a format browsers can actually display;
 *   3. all EXIF is discarded, so an uploaded photo cannot disclose where the group plays.
 * Because of (3) this is a privacy control, not an optimisation. Do not make it optional.
 */
export async function downscaleToWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not read that photo. Try again.');
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY);
    });
    if (!blob) throw new Error('Could not read that photo. Try again.');
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is still too large after shrinking.');
    return blob;
  } finally {
    bitmap.close?.();
  }
}
