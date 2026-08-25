/**
 * The maker's mark at the foot of the board. Uses the coral tile and hard offset shadow from
 * BrandMark, so it reads as a stamp on the app rather than a generic footer bolted under it.
 *
 * The link opens in a new tab on purpose: this sits on a screen people check DURING a match,
 * and navigating the table away from a live game to read a portfolio is the wrong trade for one
 * curious tap. Plain <a>, not next/link — Link is for routes inside this app.
 */
export function MadeByBanner() {
  return (
    <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border-2 border-ink bg-surface px-3 py-3 shadow-[3px_3px_0_#142D37]">
      <span className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="grid size-7 shrink-0 grid-cols-2 gap-[3px] rounded-[8px] border-2 border-ink bg-coral p-1.5">
          <span className="rounded-full bg-surface" /><span className="rounded-full bg-surface" />
          <span className="rounded-full bg-surface" /><span className="rounded-full bg-surface" />
        </span>
        <span className="text-xs leading-tight text-muted">
          <span className="block font-bold text-ink">A passion project</span>
          by Bryan Lim
        </span>
      </span>
      <a
        href="https://bryanlimjt.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[9px] border-2 border-cobalt bg-cobalt px-3 py-2 text-xs font-bold text-surface"
      >
        bryanlimjt.com ↗
      </a>
    </footer>
  );
}
