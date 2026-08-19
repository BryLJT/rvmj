import { FormActionButton } from '../../../components/FormActionButton';
import { ActionLink } from '../../../components/ui';

export function GameTopBar({
  backHref,
  continueAction,
}: {
  backHref: string | null;
  continueAction?: () => Promise<void>;
}) {
  if (!backHref && !continueAction) return null;

  return (
    <nav aria-label="Match actions" className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-7">
      {backHref ? <ActionLink href={backHref} variant="quiet">Back to table</ActionLink> : <span />}
      {continueAction ? (
        <form action={continueAction}>
          <FormActionButton idleLabel="Continue match" pendingLabel="Continuing…" />
        </form>
      ) : null}
    </nav>
  );
}
