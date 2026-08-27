export const MAX_EDGE = 1600;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const TARGET_UPLOAD_BYTES = 1.5 * 1024 * 1024;

const RETRY_EDGES = [MAX_EDGE, 1280, 1024] as const;
const RETRY_QUALITIES = [0.82, 0.72, 0.62, 0.52] as const;
const READ_ERROR = 'Could not read that photo. Try another photo.';
const SHRINK_ERROR = 'Could not shrink that photo enough. Choose another photo.';

export type PreparedPhotoType = 'image/webp' | 'image/jpeg';

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

function encode(canvas: HTMLCanvasElement, type: PreparedPhotoType, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Re-encode a phone photo to bounded, displayable bytes before anything crosses the network.
 * Drawing into a fresh canvas also discards EXIF/GPS metadata, so this is a privacy control.
 * WebP is preferred, but the returned MIME type is verified because WebKit may substitute PNG.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(READ_ERROR);
  }

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error(READ_ERROR);

    let selectedType: PreparedPhotoType | undefined;
    const attemptedSizes = new Set<string>();

    for (const maxEdge of RETRY_EDGES) {
      let firstQualityAlreadyTried = false;
      const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
      const sizeKey = `${width}x${height}`;
      if (attemptedSizes.has(sizeKey)) continue;
      attemptedSizes.add(sizeKey);

      canvas.width = width;
      canvas.height = height;
      context.drawImage(bitmap, 0, 0, width, height);

      if (!selectedType) {
        const webp = await encode(canvas, 'image/webp', RETRY_QUALITIES[0]);
        if (webp?.type === 'image/webp') {
          selectedType = 'image/webp';
          firstQualityAlreadyTried = true;
          if (webp.size <= TARGET_UPLOAD_BYTES) return webp;
        } else {
          selectedType = 'image/jpeg';
        }
      }

      const start = firstQualityAlreadyTried ? 1 : 0;
      for (let index = start; index < RETRY_QUALITIES.length; index += 1) {
        const candidate = await encode(canvas, selectedType, RETRY_QUALITIES[index]);
        if (!candidate || candidate.type !== selectedType) throw new Error(READ_ERROR);
        if (candidate.size <= TARGET_UPLOAD_BYTES) return candidate;
      }
    }

    throw new Error(SHRINK_ERROR);
  } catch (cause) {
    if (cause instanceof Error && (cause.message === READ_ERROR || cause.message === SHRINK_ERROR)) {
      throw cause;
    }
    throw new Error(READ_ERROR);
  } finally {
    bitmap.close?.();
  }
}
