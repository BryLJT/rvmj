import { BonusCard } from '../../components/BonusCard';
import { ChipSetCard } from '../../components/ChipSetCard';
import { TaiScaleCard } from '../../components/TaiScaleCard';
import { AppFrame, PageHeader } from '../../components/ui';

export default function ChipsPage() {
  return (
    <AppFrame>
      <PageHeader
        backHref="/"
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
