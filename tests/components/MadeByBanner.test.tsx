import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MadeByBanner } from '../../src/components/MadeByBanner';

describe('MadeByBanner', () => {
  it('signs the board and points at the site without stranding anyone mid-match', () => {
    render(<MadeByBanner />);
    expect(screen.getByText(/A passion project/)).toBeDefined();
    expect(screen.getByText(/by Bryan Lim/)).toBeDefined();

    const link = screen.getByRole('link', { name: /bryanlimjt\.com/ });
    expect(link.getAttribute('href')).toBe('https://bryanlimjt.com');
    expect(link.getAttribute('target')).toBe('_blank');
    // Without noopener the new tab can reach back through window.opener.
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
