import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { YearPills } from '../../src/components/YearPills';

afterEach(cleanup);

describe('YearPills', () => {
  it('offers All time first, then years newest first', () => {
    render(<YearPills years={[2025, 2026]} selected="all" />);
    expect(screen.getAllByRole('link').map((a) => a.textContent))
      .toEqual(['All time', 'AY26/27', 'AY25/26']);
  });

  it('marks the selected year for assistive technology', () => {
    render(<YearPills years={[2026]} selected={2026} />);
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBeNull();
  });

  it('names itself distinctly from the board tabs above it', () => {
    render(<YearPills years={[2026]} selected="all" />);
    expect(screen.getByRole('navigation', { name: 'Academic year' })).toBeDefined();
  });

  // All time must stay reachable now that it is no longer the default.
  it('points All time at an explicit request, not at a bare address', () => {
    render(<YearPills years={[2026]} selected={2026} />);
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('href'))
      .toBe('/?board=lifetime&year=all');
  });

  it('points a year pill at that year', () => {
    render(<YearPills years={[2026]} selected="all" />);
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('href'))
      .toBe('/?board=lifetime&year=2026');
  });

  /**
   * An empty row would read as "no years exist" rather than "nothing has been played yet", and
   * the board's own empty state already says the latter properly.
   */
  it('renders nothing at all when no year has games yet', () => {
    const { container } = render(<YearPills years={[]} selected="all" />);
    expect(container.firstChild).toBeNull();
  });

  it('gives every pill a real touch target', () => {
    render(<YearPills years={[2026, 2025]} selected="all" />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className.split(' ')).toContain('min-h-11');
    }
  });
});
