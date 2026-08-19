'use client';

import { useEffect } from 'react';
import { Button, StatePage } from '../components/ui';

export default function ErrorPage({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatePage
      tone="error"
      title="The table didn’t load"
      description="Check your connection, then try this screen again."
      action={<Button onClick={retry}>Try again</Button>}
    />
  );
}
