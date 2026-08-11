import { ChipSetCard } from '../../components/ChipSetCard';

export default function ChipsPage() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Table setup</h1>
      <p className="text-sm opacity-70">
        Every table uses the same chip composition, so end-of-game counts are comparable and the
        app can check the math. Deal each player this stack before the first hand.
      </p>
      <ChipSetCard />
    </main>
  );
}
