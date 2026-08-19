import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Seat } from '../lib/engine/types';

const seats: Record<Seat, string> = { E: 'East', S: 'South', W: 'West', N: 'North' };
const buttonTone = {
  primary: 'border-cobalt bg-cobalt text-surface shadow-[0_3px_0_#142D37]',
  secondary: 'border-ink bg-surface text-ink',
  destructive: 'border-coral bg-coral text-surface',
  quiet: 'border-transparent bg-transparent text-muted',
} as const;

export function AppFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto flex min-h-svh w-full max-w-3xl flex-col px-5 py-7 sm:px-8 sm:py-10 ${className}`}>{children}</main>;
}

export function BrandMark() {
  return (
    <div className="inline-flex items-center gap-3" role="img" aria-label="RVMJ">
      <span aria-hidden="true" className="grid size-11 grid-cols-2 gap-1 rounded-[11px] border-2 border-ink bg-coral p-2 shadow-[3px_3px_0_#142D37]">
        <span className="rounded-full bg-surface" /><span className="rounded-full bg-surface" />
        <span className="rounded-full bg-surface" /><span className="rounded-full bg-surface" />
      </span>
      <span aria-hidden="true" className="text-xl font-extrabold tracking-[-0.04em]">RVMJ</span>
    </div>
  );
}

export function PageHeader({ title, description, eyebrow, backHref }: {
  title: string; description?: string; eyebrow?: string; backHref?: string;
}) {
  return (
    <header className="mb-7">
      {backHref ? <Link href={backHref} className="mb-5 inline-flex min-h-11 items-center font-semibold text-cobalt">← Back</Link> : <BrandMark />}
      {eyebrow ? <p className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-coral">{eyebrow}</p> : null}
      <h1 className="mt-3 max-w-2xl text-3xl font-extrabold leading-tight tracking-[-0.04em] sm:text-4xl">{title}</h1>
      {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">{description}</p> : null}
    </header>
  );
}

export function Button({ variant = 'primary', busy = false, busyLabel = 'Working…', disabled, type = 'button', className = '', children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonTone; busy?: boolean; busyLabel?: string }) {
  return (
    <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
      className={`min-h-11 min-w-11 rounded-[10px] border-2 px-4 py-3 font-bold transition-[transform,box-shadow,opacity] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${buttonTone[variant]} ${className}`}>
      {busy ? busyLabel : children}
    </button>
  );
}

export function ActionLink({ href, children, variant = 'secondary', className = '' }: {
  href: string; children: ReactNode; variant?: keyof typeof buttonTone; className?: string;
}) {
  return <Link href={href} className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border-2 px-4 py-3 text-center font-bold ${buttonTone[variant]} ${className}`}>{children}</Link>;
}

export function SeatBadge({ seat }: { seat: Seat }) {
  return <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border-2 border-ink bg-cobalt-soft text-sm font-extrabold" aria-label={seats[seat]}>{seat}</span>;
}

export function PlayerRow({ seat, name, isMe = false, trailing, muted = false }: {
  seat: Seat; name: string; isMe?: boolean; trailing?: ReactNode; muted?: boolean;
}) {
  return (
    <li className="flex min-h-16 items-center gap-3 border-b border-divider py-2 last:border-b-0">
      <SeatBadge seat={seat} />
      <div className="min-w-0 flex-1"><p className={`truncate font-bold ${muted ? 'text-muted' : 'text-ink'}`}>{name}{isMe ? ' (you)' : ''}</p><p className="text-xs text-muted">{seats[seat]}</p></div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </li>
  );
}

const statusTone = {
  info: 'border-cobalt/30 bg-cobalt-soft text-ink',
  success: 'border-gain/30 bg-gain-soft text-gain',
  warning: 'border-amber/30 bg-amber-soft text-amber',
  error: 'border-coral/30 bg-coral-soft text-ink',
} as const;
const statusCue: Record<keyof typeof statusTone, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
};

export function StatusMessage({ tone, title, children, className = '' }: {
  tone: keyof typeof statusTone; title?: string; children: ReactNode; className?: string;
}) {
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[12px] border px-4 py-3 text-sm leading-6 ${statusTone[tone]} ${className}`}><p className="font-bold"><span>{statusCue[tone]}</span>{title ? <span className="ml-2">{title}</span> : null}</p><div>{children}</div></div>;
}

export function LiveRegion({ tone = 'info', title, message }: {
  tone?: keyof typeof statusTone; title?: string; message?: string;
}) {
  return <div aria-live={tone === 'error' ? 'assertive' : 'polite'} aria-atomic="true">{message ? <StatusMessage tone={tone} title={title}>{message}</StatusMessage> : null}</div>;
}

export function StatePage({ tone, title, description, action }: {
  tone: 'info' | 'warning' | 'error'; title: string; description: string; action?: ReactNode;
}) {
  return <AppFrame className="justify-center"><PageHeader title={title} /><StatusMessage tone={tone}>{description}</StatusMessage>{action ? <div className="mt-5 flex flex-col gap-3">{action}</div> : null}</AppFrame>;
}
