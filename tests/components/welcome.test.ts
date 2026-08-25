import { describe, it, expect, afterEach } from 'vitest';
import { markWelcomeSeen, readWelcomeSeen } from '../../src/lib/welcome';

/**
 * This repo's jsdom hands out a stub localStorage with no methods at all — the same environment
 * quirk HousePromptProvider.test.tsx documents. So the working store is installed per test
 * rather than assumed, and the untouched stub is used deliberately below to exercise the
 * unavailable-storage path a real Safari private window takes.
 */
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
  if (original) Object.defineProperty(window, 'localStorage', original);
});

describe('the match welcome marker', () => {
  it('remembers the match whose welcome was dismissed', () => {
    installWorkingStorage();
    markWelcomeSeen('game-1');
    expect(readWelcomeSeen()).toBe('game-1');
  });

  it('does not carry a dismissal from one match to the next', () => {
    installWorkingStorage();
    markWelcomeSeen('game-1');
    markWelcomeSeen('game-2');
    expect(readWelcomeSeen()).toBe('game-2');
  });

  it('reports nothing seen when the browser refuses storage, instead of throwing', () => {
    // The untouched stub: property present, methods absent — what a blocked-site-data browser
    // effectively presents. The welcome page showing twice beats a screen that will not render.
    expect(() => markWelcomeSeen('game-1')).not.toThrow();
    expect(readWelcomeSeen()).toBeNull();
  });
});
