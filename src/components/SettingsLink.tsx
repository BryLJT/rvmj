import Link from 'next/link';

/**
 * The gear is drawn inline rather than pulled from an icon set: RVMJ has no icon dependency and
 * one control does not justify adding one. The border and hard offset shadow match BrandMark and
 * the card header badges, so it reads as part of the same object language.
 *
 * The glyph is hidden from assistive technology and the LINK carries the name. An icon-only
 * control with no accessible name announces as "link" and is unusable with a screen reader,
 * which no amount of visual review would catch.
 */
export function SettingsLink() {
  return (
    <Link href="/account" aria-label="Account settings"
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[11px] border-2 border-ink bg-surface shadow-[3px_3px_0_#142D37]">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3.25" />
        <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
      </svg>
    </Link>
  );
}
