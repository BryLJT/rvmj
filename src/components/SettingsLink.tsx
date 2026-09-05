import Link from 'next/link';

/**
 * The gear is drawn inline rather than pulled from an icon set: RVMJ has no icon dependency and
 * one control does not justify adding one. The border and hard offset shadow match BrandMark and
 * the card header badges, so it reads as part of the same object language.
 *
 * The glyph is hidden from assistive technology and the LINK carries the name. An icon-only
 * control with no accessible name announces as "link" and is unusable with a screen reader,
 * which no amount of visual review would catch.
 *
 * Drawing a gear by hand has one trap, and this file fell into it once: an earlier version was a
 * centre circle ringed by eight detached spokes, which is the recipe for a SUN, not a gear. What
 * separates them is the rim. Gear teeth sit on a solid rim and the hole is cut out of it; sun rays
 * float free of the disc. So the outline below runs rim -> tooth flank -> flat tip -> flank -> rim
 * eight times, closing each valley with an arc along the rim, and the centre hole is a second
 * subpath punched out by `fillRule="evenodd"`. Filled rather than stroked because at the 20px this
 * renders at, outline teeth close up into a blur.
 *
 * No test can see this. The suite checks the href, the accessible name and the touch target, all
 * of which passed the entire time the sun was shipping. Changing the path means looking at it.
 */
export function SettingsLink() {
  return (
    <Link href="/account" aria-label="Account settings"
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[11px] border-2 border-ink bg-surface shadow-[3px_3px_0_#142D37]">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor">
        <path fillRule="evenodd" d="M9.93 5.0L10.39 1.83L13.61 1.83L14.07 5.0A7.3 7.3 0 0 1 15.48 5.58L18.05 3.67L20.33 5.95L18.42 8.52A7.3 7.3 0 0 1 19.0 9.93L22.17 10.39L22.17 13.61L19.0 14.07A7.3 7.3 0 0 1 18.42 15.48L20.33 18.05L18.05 20.33L15.48 18.42A7.3 7.3 0 0 1 14.07 19.0L13.61 22.17L10.39 22.17L9.93 19.0A7.3 7.3 0 0 1 8.52 18.42L5.95 20.33L3.67 18.05L5.58 15.48A7.3 7.3 0 0 1 5.0 14.07L1.83 13.61L1.83 10.39L5.0 9.93A7.3 7.3 0 0 1 5.58 8.52L3.67 5.95L5.95 3.67L8.52 5.58A7.3 7.3 0 0 1 9.93 5.0ZM8.65 12.0a3.35 3.35 0 1 0 6.7 0a3.35 3.35 0 1 0 -6.7 0Z" />
      </svg>
    </Link>
  );
}
