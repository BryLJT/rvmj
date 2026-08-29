import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../lib/supabase/server';
import { createAdminClient } from '../../lib/supabase/admin';
import { parseYearParam } from '../../lib/academic-year';
import { PHOTO_BUCKET, SIGNED_URL_TTL_SECONDS } from '../../lib/image';
import { one } from '../../lib/notable-claim';
import { standingsHref } from '../../lib/standings';
import { AppFrame, PageHeader, StatusMessage } from '../../components/ui';
import { HandsGallery, type HandPhoto } from './HandsGallery';

export const dynamic = 'force-dynamic';

type Row = {
  id: string;
  created_at: string;
  photo_path: string;
  logged_by: string;
  players: { display_name: string } | { display_name: string }[] | null;
  notable_claim_types: {
    notable_hands: { name: string } | { name: string }[] | null;
  }[] | null;
};

/**
 * The standings board hands this page the period and hand types the player was looking at, so
 * the back arrow can return them to that exact view. They are RETURN STATE and nothing else: the
 * archive below never reads them, and shows every photographed win newest first as it always has.
 *
 * Both addresses built here are rebuilt from the parts, never carried whole. `parseYearParam`
 * accepts only a four-digit year in range or `all`, and the paths (`/?board=skill` via
 * `standingsHref`, and `/hands`) are literals in this file with the rest written as encoded query
 * values — so the worst a hand-typed `/hands?…` can do is aim them at another view of this same
 * app. A parameter used verbatim as an href would instead be somewhere to park any URL at all.
 * That matters most for the login `next` below, which IS a redirect target.
 *
 * The IDs are deliberately NOT checked against the catalogue here. The standings page already
 * re-validates every `hand` value against it on arrival, exactly as it does for any hand-typed
 * address, and a second check here would be a second place for that rule to drift.
 *
 * `searchParams` is optional so a bare `/hands` — typed, bookmarked, or reached from anywhere
 * that is not the board — still renders, with today's plain back link.
 */
export default async function HandsPage({ searchParams }: {
  searchParams?: Promise<{ year?: string | string[]; hand?: string | string[] }>;
} = {}) {
  const { year: rawYear, hand: rawHand } = (await searchParams) ?? {};
  const returnYear = parseYearParam(rawYear);
  // Deduplicated and sorted so the two addresses below agree, and so one player's link is the
  // same string as another's from the same board. `standingsHref` does this internally anyway.
  const handIds = [...new Set(
    Array.isArray(rawHand) ? rawHand : typeof rawHand === 'string' ? [rawHand] : [],
  )].sort();
  const backHref = returnYear === null
    ? '/?board=skill'
    : standingsHref({ board: 'skill', year: returnYear, handIds });

  // Where to come back to AFTER signing in. The Notable wins board renders publicly, so a
  // signed-out visitor can arrive here from a filtered board — and without this the login wall
  // eats their period and filters, landing them on a bare archive whose back arrow returns them
  // to a reset board. That is the same hole the back arrow closes, one redirect further along.
  const returnQuery = new URLSearchParams();
  // The two parts stand on their own. An unusable year is no reason to drop the hand filters as
  // well — that threw away most of the selection this block exists to protect, and it did it in
  // the one case where the address was already partly unreadable.
  if (returnYear !== null) returnQuery.set('year', String(returnYear));
  for (const handId of handIds) returnQuery.append('hand', handId);
  const selfHref = returnQuery.toString() ? `/hands?${returnQuery.toString()}` : '/hands';

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  // Photos are for the people who play, never for a search engine.
  if (!user) redirect(`/login?next=${encodeURIComponent(selfHref)}`);

  const admin = createAdminClient();
  // notable_claims has TWO foreign keys to players (player_id and logged_by), so the embed must
  // name the constraint or PostgREST cannot tell which relationship is meant.
  const { data, error } = await admin
    .from('notable_claims')
    .select(`
  id,
  created_at,
  photo_path,
  logged_by,
  players!notable_claims_player_id_fkey(display_name),
  notable_claim_types(notable_hands(name))
`)
    .not('photo_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60);

  // Vague on screen, specific in the logs: a named-constraint typo in the embed above would
  // otherwise be indistinguishable from an empty archive.
  if (error) console.error('[hands]', error.message);

  const rows = (data ?? []) as Row[];
  let photos: HandPhoto[] = [];
  if (rows.length > 0) {
    const { data: signed } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrls(rows.map((row) => row.photo_path), SIGNED_URL_TTL_SECONDS);
    const byPath = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl]));
    photos = rows.flatMap((row) => {
      // A path that fails to sign comes back with an empty signedUrl, and is dropped here rather
      // than rendered. A missing thumbnail is a blank space; a broken one is a visible fault
      // nobody at the table can do anything about.
      const url = byPath.get(row.photo_path);
      if (!url) return [];
      const handNames = (row.notable_claim_types ?? [])
        .flatMap((claimType) => {
          const name = one(claimType.notable_hands)?.name;
          return name ? [name] : [];
        })
        .sort((left, right) => left.localeCompare(right));
      return [{
        claimId: row.id,
        url,
        playerName: one(row.players)?.display_name ?? '?',
        handNames,
        playedAt: row.created_at,
        // Presentation only. clear_notable_photo re-checks this inside its own transaction, so
        // a forged flag buys nothing.
        mine: row.logged_by === user.id,
      }];
    });
  }

  return (
    <AppFrame>
      <PageHeader backHref={backHref} title="Notable hands"
        description="Every hand worth photographing, newest first." />
      {error ? (
        <StatusMessage tone="error">Couldn’t load the archive just now. Refresh to try again.</StatusMessage>
      ) : (
        <HandsGallery photos={photos} />
      )}
    </AppFrame>
  );
}
