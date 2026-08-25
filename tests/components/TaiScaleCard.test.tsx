import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TaiScaleCard } from '../../src/components/TaiScaleCard';

describe('TaiScaleCard', () => {
  it('gives each tai the points that actually change hands', () => {
    render(<TaiScaleCard />);
    const table = screen.getByRole('table', { name: 'Tai scale' });
    expect(within(table).getByText('Discarder / self-draw')).toBeDefined();
    expect(within(table).getByText('Other players')).toBeDefined();

    // header + one row per tai, minTai 1 through cap 5
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6);

    // the cap row, derived: 5 tai is a base of 16, so 32 across and 16 from the other two
    expect(within(rows[5]).getByText('32')).toBeDefined();
    expect(within(rows[5]).getByText('16')).toBeDefined();
  });
});
