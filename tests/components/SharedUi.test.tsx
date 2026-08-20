import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionLink, BrandMark, Button, LiveRegion, PageHeader, PlayerRow, StatusMessage } from '../../src/components/ui';

afterEach(cleanup);

describe('Refined Tile Club primitives', () => {
  it('gives the brand tile one accessible RVMJ name', () => {
    render(<BrandMark />);
    expect(screen.getByRole('img', { name: 'RVMJ' })).toBeDefined();
  });

  it('locks a busy action and announces its operation', () => {
    const onClick = vi.fn();
    render(<Button busy busyLabel="Checking counts…" onClick={onClick}>Check all counts</Button>);
    const button = screen.getByRole('button', { name: 'Checking counts…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives button-shaped actions a 44px minimum width', () => {
    render(<><Button>Save</Button><ActionLink href="/review">Review</ActionLink></>);
    expect(screen.getByRole('button', { name: 'Save' }).className.split(' ')).toContain('min-w-11');
    expect(screen.getByRole('link', { name: 'Review' }).className.split(' ')).toContain('min-w-11');
  });

  it('uses the approved surface token for filled-action text', () => {
    render(<><Button>Save</Button><ActionLink href="/delete" variant="destructive">Delete</ActionLink></>);
    expect(screen.getByRole('button', { name: 'Save' }).className.split(' ')).toContain('text-surface');
    expect(screen.getByRole('link', { name: 'Delete' }).className.split(' ')).toContain('text-surface');
  });

  it('names a seat and marks the local player in words', () => {
    render(<PlayerRow seat="E" name="Bryan" isMe trailing={<span>+120</span>} />);
    expect(screen.getByText('East')).toBeDefined();
    expect(screen.getByText('Bryan (you)')).toBeDefined();
    expect(screen.getByText('+120')).toBeDefined();
  });

  it('uses alert semantics only for failures', () => {
    const { rerender } = render(<StatusMessage tone="warning">Recount the $10 chips.</StatusMessage>);
    expect(screen.getByRole('status')).toBeDefined();
    rerender(<StatusMessage tone="error">Could not reach the table.</StatusMessage>);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it.each([
    ['info', 'Info'],
    ['success', 'Success'],
    ['warning', 'Warning'],
    ['error', 'Error'],
  ] as const)('gives the %s status a visible non-colour cue', (tone, cue) => {
    render(<StatusMessage tone={tone} title="Count update">Review the table.</StatusMessage>);
    expect(screen.getByText(cue)).toBeDefined();
    expect(screen.getByText('Count update')).toBeDefined();
  });

  it('mounts a live region before its message changes', () => {
    const { container, rerender } = render(<LiveRegion tone="error" />);
    const region = container.querySelector('[aria-live="assertive"]');
    expect(region?.textContent).toBe('');
    rerender(<LiveRegion tone="error" message="Could not reach the table." />);
    expect(container.querySelector('[aria-live="assertive"]')).toBe(region);
    expect(region?.textContent).toContain('Could not reach the table.');
  });

  // The final result screen needs an exit in the corner the thumb already reaches for. Putting it
  // on the title row mirrors FullScreenPanel's header (title left, action right) rather than
  // inventing a second convention for the same gesture.
  it('places a trailing action on the same row as the title', () => {
    render(<PageHeader title="Final result" trailing={<ActionLink href="/">Leaderboard</ActionLink>} />);

    const heading = screen.getByRole('heading', { name: 'Final result' });
    const link = screen.getByRole('link', { name: 'Leaderboard' });
    expect(heading.parentElement?.contains(link)).toBe(true);
    expect(heading.parentElement?.className.split(' ')).toContain('justify-between');
  });

  it('leaves the title row alone when there is no trailing action', () => {
    render(<PageHeader title="Table setup" description="Deal each player this stack." />);

    expect(screen.getByRole('heading', { name: 'Table setup' })).toBeDefined();
    expect(screen.getByText('Deal each player this stack.')).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
