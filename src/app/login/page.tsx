'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase/client';

function LoginInner() {
  const next = useSearchParams().get('next') ?? '/';
  const signIn = () => {
    const supabase = createClient();
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  };
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">RVMJ</h1>
      <p className="text-sm opacity-70">Sign in once — after this, tapping the table takes you straight in.</p>
      <button onClick={signIn} className="rounded-lg border px-6 py-3 font-medium">
        Sign in with Google
      </button>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
