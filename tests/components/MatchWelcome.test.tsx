import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MatchWelcome } from '../../src/app/game/[id]/MatchWelcome';

const original = Object.getOwnPropertyDescriptor(window, 'localStorage');

function installWorkingStorage() {
  const entries = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
    },
  });
}

afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(window, 'localStorage', original);
});

describe('MatchWelcome', () => {
  it('greets the table at the start of a match nobody has dismissed', () => {
    installWorkingStorage();
    render(<MatchWelcome gameId="game-1" status="active" />);
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('table', { name: 'Tai scale' })).toBeDefined();
    expect(screen.getByRole('table', { name: 'Standard chip set' })).toBeDefined();
  });

  it('gets out of the way when this player taps through', () => {
    installWorkingStorage();
    render(<MatchWelcome gameId="game-1" status="active" />);
    fireEvent.click(screen.getByRole('button', { name: 'Let\u2019s play' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays shut for a match this phone has already seen', () => {
    installWorkingStorage();
    window.localStorage.setItem('rvmj:welcome-seen', 'game-1');
    render(<MatchWelcome gameId="game-1" status="active" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('greets the table again for the next match', () => {
    installWorkingStorage();
    window.localStorage.setItem('rvmj:welcome-seen', 'game-1');
    render(<MatchWelcome gameId="game-2" status="active" />);
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('never greets a match that has already been counted up', () => {
    installWorkingStorage();
    render(<MatchWelcome gameId="game-1" status="ended" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
