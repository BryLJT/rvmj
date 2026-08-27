import { BonusCard } from '../../components/BonusCard';
import { ChipSetCard } from '../../components/ChipSetCard';
import { TaiScaleCard } from '../../components/TaiScaleCard';
import { AppFrame, PageHeader } from '../../components/ui';
import { rulesBackHref } from '../../lib/rules-link';

/**
 * Reached from the leaderboard and from three in-match screens, so Back cannot be a constant.
 * It used to send everyone to the leaderboard, which stranded the mid-match majority: three of
 * the four ways in are during play. The match travels as an id and `rulesBackHref` builds the
 * destination from it, so a reader who arrived from the board still leaves to the board.
 */
export default async function ChipsPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const { game } = await searchParams;
  return (
    <AppFrame>
      <PageHeader
        backHref={rulesBackHref(game)}
        title="House rules"
        description="What a hand is worth, what the bonuses cost, and the stack every player starts with. Every figure here comes from the same code that settles a game, so this page and the app cannot disagree."
      />
      <div className="flex flex-col gap-4">
        <TaiScaleCard />
        <BonusCard />
        <ChipSetCard />
      </div>
    </AppFrame>
  );
}
