'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppFrame, BrandMark, Button, LiveRegion } from '../../components/ui';
import { createClient } from '../../lib/supabase/client';

function LoginInner() {
  const next = useSearchParams().get('next') ?? '/';
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string>();

  const signIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setError(undefined);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (signInError) setError(signInError.message);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <AppFrame className="justify-center">
      <BrandMark />
      <h1 className="mt-8 text-4xl font-extrabold tracking-[-0.04em]">One sign-in. Then tap straight into your seat.</h1>
      <p className="mt-4 leading-7 text-muted">RVMJ remembers your player identity so future NFC taps can take you directly to the table.</p>
      <Button className="mt-8 w-full" busy={signingIn} busyLabel="Opening Google…" onClick={signIn}>Sign in with Google</Button>
      <div className="mt-4"><LiveRegion tone="error" message={error} /></div>
    </AppFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
