import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { YearPills } from '../../src/components/YearPills';

afterEach(cleanup);

describe('YearPills', () => {
  it('offers All time first, then years newest first', () => {
    render(<YearPills years={[2025, 2026]} selected="all" board="skill" handIds={['hand-b', 'hand-a', 'hand-a']} />);
    expect(screen.getAllByRole('link').map((a) => a.textContent))
      .toEqual(['All time', 'AY26/27', 'AY25/26']);
  });

  it('marks the selected year for assistive technology', () => {
    render(<YearPills years={[2026]} selected={2026} board="form" handIds={[]} />);
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks All time, but not a year, when All time is selected', () => {
    render(<YearPills years={[2026]} selected="all" board="form" handIds={[]} />);
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('aria-current')).toBeNull();
  });

  it('names itself distinctly from the board tabs above it', () => {
    render(<YearPills years={[2026]} selected="all" board="lifetime" handIds={[]} />);
    expect(screen.getByRole('navigation', { name: 'Academic year' })).toBeDefined();
  });

  // All time must stay reachable now that it is no longer the default.
  it('points All time at an explicit request, not at a bare address', () => {
    render(<YearPills years={[2026]} selected={2026} board="skill" handIds={['hand-b', 'hand-a', 'hand-a']} />);
    expect(screen.getByRole('link', { name: 'All time' }).getAttribute('href'))
      .toBe('/?board=skill&year=all&hand=hand-a&hand=hand-b');
  });

  it('points a year pill at that year while preserving board and filters', () => {
    render(<YearPills years={[2026]} selected="all" board="form" handIds={['hand-b', 'hand-a', 'hand-a']} />);
    expect(screen.getByRole('link', { name: 'AY26/27' }).getAttribute('href'))
      .toBe('/?board=form&year=2026&hand=hand-a&hand=hand-b');
  });

  /**
   * An empty row would read as "no years exist" rather than "nothing has been played yet", and
   * the board's own empty state already says the latter properly.
   */
  it('renders nothing at all when no year has games yet', () => {
    const { container } = render(<YearPills years={[]} selected="all" board="lifetime" handIds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('gives every pill a real touch target', () => {
    render(<YearPills years={[2026, 2025]} selected="all" board="lifetime" handIds={[]} />);
    for (const link of screen.getAllByRole('link')) {
      expect(link.className.split(' ')).toContain('min-h-11');
      expect(link.className.split(' ')).toContain('min-w-11');
    }
  });

  it('scrolls its own row horizontally as years accumulate', () => {
    render(<YearPills years={[2026]} selected="all" board="lifetime" handIds={[]} />);
    expect(screen.getByRole('navigation', { name: 'Academic year' }).className.split(' '))
      .toContain('overflow-x-auto');
  });
});
