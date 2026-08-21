'use client';

import { Button } from './ui';
import { useHousePrompt } from './HousePromptProvider';

/**
 * The between-sign-ins route in. Compact and secondary on purpose: choosing a house is optional,
 * so this must not compete with the leaderboard it sits above.
 */
export function ChooseHouseAction() {
  const { open } = useHousePrompt();
  return (
    <Button variant="secondary" className="px-3 py-2 text-sm" onClick={open}>
      Choose your house
    </Button>
  );
}
