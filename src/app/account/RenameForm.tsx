'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, LiveRegion } from '../../components/ui';
import { renameMe } from '../../lib/actions/account';
import { MAX_DISPLAY_NAME, type RenameResult } from '../../lib/account';

const MESSAGES: Record<string, { tone: 'success' | 'info' | 'error'; text: string }> = {
  saved: { tone: 'success', text: 'Saved. The boards will show your new name.' },
  unchanged: { tone: 'info', text: 'That is already your name, so nothing changed.' },
  blank: { tone: 'error', text: 'Your name cannot be empty.' },
  too_long: { tone: 'error', text: `Keep it to ${MAX_DISPLAY_NAME} characters or fewer.` },
  expired: { tone: 'error', text: 'Your sign-in expired. Sign in again; your typing is still here.' },
  failed: { tone: 'error', text: 'Could not save that just now. Try again.' },
};

export function RenameForm({ current }: { current: string }) {
  const router = useRouter();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RenameResult>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const outcome = await renameMe(name);
    setResult(outcome);
    setBusy(false);
    // The typed value is deliberately NOT cleared on any outcome. A failed save that also
    // discarded the name would make the player retype it just to find out whether it was a fluke.
    if (outcome.status === 'saved') router.refresh();
  };

  const key = result?.status === 'invalid' ? result.reason : result?.status;
  const message = key ? MESSAGES[key] : undefined;

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
      <label htmlFor="display-name" className="text-sm font-bold">Display name</label>
      <input id="display-name" name="display-name" value={name} maxLength={MAX_DISPLAY_NAME}
        onChange={(event) => setName(event.target.value)} autoComplete="nickname"
        className="min-h-11 rounded-[10px] border-2 border-ink bg-surface px-4 font-bold" />
      <p className="text-xs leading-5 text-muted">
        This is the name every board shows, including games you have already played.
        Changing it renames you everywhere.
      </p>
      <Button type="submit" busy={busy} busyLabel="Saving…" disabled={name.trim() === ''}>Save</Button>
      <LiveRegion tone={message?.tone ?? 'info'} message={message?.text} />
    </form>
  );
}
