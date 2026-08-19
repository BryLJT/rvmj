'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, StatePage } from '../components/ui';

export default function ErrorPage({ error, retry }: { error: Error; retry: () => void }) {
  const retryingRef = useRef(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const handleRetry = () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    retry();
  };

  return (
    <StatePage
      tone="error"
      title="The table didn’t load"
      description="Check your connection, then try this screen again."
      action={<Button busy={retrying} busyLabel="Trying again…" onClick={handleRetry}>Try again</Button>}
    />
  );
}
