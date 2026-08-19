import { ActionLink, StatePage } from '../components/ui';

export default function NotFound() {
  return (
    <StatePage
      tone="warning"
      title="Nothing at this address"
      description="The page may have moved or the link may be incomplete."
      action={<ActionLink href="/">Back to the leaderboard</ActionLink>}
    />
  );
}
