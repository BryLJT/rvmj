import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../lib/supabase/server';
import { createAdminClient } from '../../lib/supabase/admin';
import { findHouse, NO_HOUSE_LABEL } from '../../lib/houses';
import { AppFrame, PageHeader, StatusMessage } from '../../components/ui';
import { RenameForm } from './RenameForm';

export const dynamic = 'force-dynamic';

/**
 * The house is SHOWN and not editable. It is permanent by design — 0006 enforces that with a
 * trigger that binds even the service role — and a control that cannot do anything is worse than
 * a plain line of text.
 *
 * The profile is read with the service role, like every other read in this app; the browser
 * never holds that credential. The redirect fires before the read, so a signed-out visitor
 * causes no query at all.
 */
export default async function AccountPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/account')}`);

  const { data, error } = await createAdminClient()
    .from('players').select('display_name, house').eq('id', user.id).maybeSingle();
  // The rendered line is deliberately vague; the operator's copy must not be.
  if (error) console.error('[account]', error.message);

  const house = findHouse(data?.house);

  return (
    <AppFrame>
      <PageHeader backHref="/" title="Your account"
        description="The name here is the one every board shows." />
      {!data ? (
        // An empty page would read as "you have no account". Say the read failed instead.
        <StatusMessage tone="error">Couldn’t load your account just now. Refresh to try again.</StatusMessage>
      ) : (
        <>
          <dl className="rounded-[14px] border border-divider bg-surface p-5">
            <dt className="text-xs font-bold uppercase tracking-[0.18em] text-muted">House</dt>
            <dd className="mt-1 font-bold">{house ? house.name : NO_HOUSE_LABEL}</dd>
          </dl>
          <RenameForm current={data.display_name} />
        </>
      )}
    </AppFrame>
  );
}
