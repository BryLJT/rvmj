import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrandMark, Button, LiveRegion, PlayerRow, StatusMessage } from '../../src/components/ui';

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

  it('mounts a live region before its message changes', () => {
    const { container, rerender } = render(<LiveRegion tone="error" />);
    const region = container.querySelector('[aria-live="assertive"]');
    expect(region?.textContent).toBe('');
    rerender(<LiveRegion tone="error" message="Could not reach the table." />);
    expect(container.querySelector('[aria-live="assertive"]')).toBe(region);
    expect(region?.textContent).toContain('Could not reach the table.');
  });
});
