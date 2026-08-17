export function GameTopBar({
  backHref,
  continueAction,
}: {
  backHref: string | null;
  continueAction?: () => Promise<void>;
}) {
  if (!backHref && !continueAction) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-8 pt-6">
      {backHref ? <a href={backHref} className="text-sm underline">Back</a> : <span />}
      {continueAction ? (
        <form action={continueAction}>
          <button type="submit" className="rounded bg-black px-4 py-2 text-sm font-medium text-white">
            Continue match
          </button>
        </form>
      ) : null}
    </div>
  );
}
