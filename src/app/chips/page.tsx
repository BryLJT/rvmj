import { ChipSetCard } from '../../components/ChipSetCard';
import { AppFrame, PageHeader } from '../../components/ui';

export default function ChipsPage() {
  return (
    <AppFrame>
      <PageHeader
        backHref="/"
        title="Table setup"
        description="Every table uses the same chip composition, so end-of-game counts are comparable and the app can check the math. Deal each player this stack before the first hand."
      />
      <ChipSetCard />
    </AppFrame>
  );
}
