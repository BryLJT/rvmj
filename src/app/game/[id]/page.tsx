import { redirect } from 'next/navigation';
import { createServerSupabase } from '../../../lib/supabase/server';
import { continueMatch } from '../../../lib/actions/game';
import { ACTIVE_TTL_MS } from '../../../lib/join';
import { FormingScreen } from './FormingScreen';
import { ChipLive } from './ChipLive';
import { MatchWelcome } from './MatchWelcome';
import { GameLive } from './GameLive';
import { GameTopBar } from './GameTopBar';
import { StatePage } from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const raw = (await searchParams).from;
  // Narrow once, at the door. A query string may legally carry the same label twice, in which
  // case this arrives as an array — so the declared type is a promise about the outside world
  // that nobody can keep. Anything that is not a single string is treated as absent, which is
  // not a new error path but the ordinary case: reach a match directly and there is no tag,
  // no Back and no Continue, and that already works.
  const from = typeof raw === 'string' && raw.length > 0 ? raw : undefined;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  // Carry the tag through sign-in. Viewing a match does not depend on who you are, so an
  // expired session should return you to the screen you left, Back link intact, rather than
  // to a dead end that forces another trip to the table.
  if (!user) {
    const next = `/game/${id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // Shown only when arriving from a tag tap ("view last match"), so someone checking an
  // abandoned match is never stranded with no way back to the choice they were making.
  //
  // `from` is a TAG SECRET, not a URL, and the href is always "/t/" + one encoded segment.
  // That is what makes it safe by construction rather than by filtering: no value of `from`
  // can turn this into an absolute URL, a protocol-relative "//evil.com", or a javascript:
  // target. Accepting a caller-supplied PATH here would reopen the open-redirect class that
  // already bit this project once in the OAuth callback.
  const back = from ? `/t/${encodeURIComponent(from)}` : null;
  const unavailable = (title: string, description: string) => (
    <><GameTopBar backHref={back} /><StatePage tone="warning" title={title} description={description} /></>
  );
  const { data: game } = await supabase
    .from('games')
    .select('id, status, mode, rules, table_id, last_activity_at, game_players(player_id, seat, players(display_name))')
    .eq('id', id).single();
  if (!game) return unavailable('Game not found', 'This match does not exist or is no longer available.');
  if (game.status === 'expired') {
    return unavailable('This match expired', 'It ended without a recorded chip result.');
  }

  const players = (game.game_players ?? []).map(
    (gp: { player_id: string; seat: string; players: { display_name: string } | { display_name: string }[] | null }) => ({
      playerId: gp.player_id,
      seat: gp.seat as 'E' | 'S' | 'W' | 'N',
      name: Array.isArray(gp.players) ? gp.players[0]?.display_name ?? '?' : gp.players?.display_name ?? '?',
    }),
  );

  // Resume is offered here, after you have SEEN the match, and only when both hold: the match
  // really is abandoned, and you are the player who sat East IN THIS MATCH.
  //
  // The host is read from the match's own record, not from wherever anyone sits tonight. Tie
  // it to tonight's seat and a match becomes unresumable the moment its host moves chairs —
  // the people who played would be present and willing, with only destruction available.
  //
  // The tag is NOT part of this decision; it is a return address for the Back link and the
  // action's fallback. Both questions that grant permission are answered from the match, and
  // the action re-checks them server-side, so this is presentation only.
  const isAbandoned =
    game.status === 'active' &&
    // This forced-dynamic Server Component intentionally evaluates staleness at request time.
    // eslint-disable-next-line react-hooks/purity
    Date.now() - new Date(game.last_activity_at).getTime() > ACTIVE_TTL_MS;
  const isMatchHost = players.some((p) => p.seat === 'E' && p.playerId === user.id);
  const wrap = (node: React.ReactNode) => (
    <>
      <GameTopBar
        backHref={back}
        continueAction={isAbandoned && isMatchHost ? continueMatch.bind(null, game.id, from) : undefined}
      />
      {node}
    </>
  );

  if (game.status === 'forming') return wrap(<FormingScreen gameId={game.id} players={players} />);

  // The catalogue names the hand types; it does not decide whether a game can be ended. A failure
  // here is logged rather than silently coerced away — vague on screen, specific in the logs, as
  // everywhere else — and the live screen degrades the LABEL to "Hand type unavailable" instead of
  // reading an empty catalogue as a broken table and closing the controls four people are waiting
  // on. `?? []` below is the degraded catalogue, not a pretence that the read succeeded.
  const { data: notableHands, error: notableHandsError } = await supabase
    .from('notable_hands').select('id, name, local_name, rarity').order('name');
  if (notableHandsError) console.error('[notable_hands]', notableHandsError.message);

  if (game.mode === 'chips')
    // chip games are never quarantined (end_game asserts app mode), so the cast is safe
    return wrap(
      <>
        {/* Mounted beside ChipLive rather than inside it: the welcome owns its own visibility and
            ChipLive's sync logic stays untouched. */}
        <MatchWelcome gameId={game.id} status={game.status as 'active' | 'ended'} />
        <ChipLive gameId={game.id} status={game.status as 'active' | 'ended'} players={players}
          me={user.id} notableHands={notableHands ?? []} />
      </>,
    );
  return wrap(<GameLive gameId={game.id} status={game.status as 'active' | 'ended' | 'quarantined'} rules={game.rules}
    players={players} me={user.id} notableHands={notableHands ?? []} />);
}
