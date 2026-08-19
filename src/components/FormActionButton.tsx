'use client';

import { useFormStatus } from 'react-dom';
import { Button } from './ui';

export function FormActionButton({ idleLabel, pendingLabel, variant = 'primary' }: {
  idleLabel: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary' | 'destructive';
}) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} busy={pending} busyLabel={pendingLabel}>{idleLabel}</Button>;
}
