import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FullScreenPanel } from '../../src/components/FullScreenPanel';

afterEach(cleanup);

describe('FullScreenPanel', () => {
  it('names the modal, moves focus in, closes on Escape, and restores focus', () => {
    const close = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<FullScreenPanel title="Count chips" onDismiss={close}><button>First action</button></FullScreenPanel>);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Count chips' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('wraps Tab focus inside the dialog', () => {
    render(<FullScreenPanel title="Confirm count"><button>First</button><button>Last</button></FullScreenPanel>);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
