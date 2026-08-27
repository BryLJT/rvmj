import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsLink } from '../../src/components/SettingsLink';

afterEach(cleanup);

describe('SettingsLink', () => {
  it('leads to the account page', () => {
    render(<SettingsLink />);
    expect(screen.getByRole('link', { name: 'Account settings' }).getAttribute('href')).toBe('/account');
  });

  /**
   * An icon is not a label. Without an accessible name this control announces as "link" and is
   * unusable with a screen reader, which is the one failure a purely visual review never catches.
   */
  it('carries a real name for assistive technology, and hides the decorative glyph', () => {
    const { container } = render(<SettingsLink />);
    expect(screen.getByRole('link', { name: 'Account settings' })).toBeDefined();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a real touch target', () => {
    render(<SettingsLink />);
    const classes = screen.getByRole('link', { name: 'Account settings' }).className.split(' ');
    expect(classes).toContain('min-h-11');
    expect(classes).toContain('min-w-11');
    expect(classes).toContain('inline-flex');
  });
});
