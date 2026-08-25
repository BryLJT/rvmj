import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BonusCard } from '../../src/components/BonusCard';

describe('BonusCard', () => {
  it('lists every bonus with the flat points it costs each player', () => {
    render(<BonusCard />);
    const table = screen.getByRole('table', { name: 'Bonus payments' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6); // header + five bonuses

    const dealt = within(table).getByText('Pair complete at the deal').closest('tr');
    expect(within(dealt as HTMLElement).getByText('2')).toBeDefined();
    expect(within(table).getByText('Added kong')).toBeDefined();
  });
});
