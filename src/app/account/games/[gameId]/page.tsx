import { notFound, redirect } from 'next/navigation';
import { getHistoricalGame } from '../../../../lib/actions/history';
import { createServerSupabase } from '../../../../lib/supabase/server';
import { isClaimId } from '../../../../lib/notable-claim';
import { GameHistoryDetail } from './GameHistoryDetail';
export const dynamic = 'force-dynamic';
export default async function HistoricalGamePage({ params }: {
  params: Promise<{
    gameId: string;
  }>;
}) {
  const { gameId } = await params;
  if (!isClaimId(gameId))
    notFound();
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user)
    redirect(`/login?next=${encodeURIComponent(`/account/games/${gameId}`)}`);
  const detail = await getHistoricalGame(gameId);
  if (detail.status === 'expired')
    redirect(`/login?next=${encodeURIComponent(`/account/games/${gameId}`)}`);
  if (detail.status === 'absent')
    notFound();
  return <GameHistoryDetail detail={detail} viewerId={user.id}/>;
}
