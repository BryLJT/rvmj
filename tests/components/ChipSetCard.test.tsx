import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChipSetCard } from '../../src/components/ChipSetCard';

describe('ChipSetCard', () => {
  it('renders every denomination and the derived totals from chips.ts', () => {
    render(<ChipSetCard />);
    expect(screen.getByText('$50')).toBeDefined();
    expect(screen.getByText('400 pts')).toBeDefined();   // stack — derived, not hard-coded in the component
    expect(screen.getByText('1600 pts')).toBeDefined();  // table total
    expect(screen.getByRole('table', { name: 'Standard chip set' })).toBeDefined();
    expect(screen.getByText('Per player')).toBeDefined();
    expect(screen.getByText('Whole table')).toBeDefined();
  });
});
