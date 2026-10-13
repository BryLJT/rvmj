import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BoardRow } from '../../src/components/BoardRow';
import { HouseFilterPanel } from '../../src/components/HouseFilterPanel';
import { NotableWinRow } from '../../src/components/NotableWinRow';
import { HOUSES, findHouse } from '../../src/lib/houses';

afterEach(cleanup);

describe('HouseFilterPanel', () => {
  it('is folded away until asked for, and shows no chip when nobody chose a house', () => {
    render(<HouseFilterPanel selected={null} board="lifetime" year="all" handIds={[]} />);

    const panel = screen.getByText('Filter by house').closest('details') as HTMLDetailsElement;
    expect(panel.open).toBe(false);
    expect(screen.queryByRole('link', { name: /^Remove / })).toBeNull();
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBe('page');
  });

  it('offers everyone, the seven houses in their colours, and the players with no house', () => {
    render(<HouseFilterPanel selected={null} board="form" year={2026} handIds={[]} />);

    const choices = [...screen.getByRole('navigation', { name: 'House' }).querySelectorAll('a')];
    expect(choices.map((a) => a.textContent)).toEqual(['All', ...HOUSES.map((house) => house.name), 'No house']);
    expect(choices.map((a) => a.getAttribute('href'))).toEqual([
      '/?board=form&year=2026',
      ...HOUSES.map((house) => `/?board=form&year=2026&house=${house.id}`),
      '/?board=form&year=2026&house=none',
    ]);
    const rusa = screen.getByRole('link', { name: 'Rusa' });
    expect(rusa.style.backgroundColor).toBe('rgb(47, 100, 79)');
    expect(rusa.style.color).toBe('rgb(255, 253, 248)');
  });

  it('marks the chosen house and offers one tap back to everyone', () => {
    render(<HouseFilterPanel selected="orcaella" board="lifetime" year="all" handIds={[]} />);

    expect(screen.getByRole('link', { name: 'Orcaella' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBeNull();
    const chip = screen.getByRole('link', { name: 'Remove Orcaella filter' });
    expect(chip.getAttribute('href')).toBe('/?board=lifetime&year=all');
    expect(chip.style.backgroundColor).toBe('rgb(242, 181, 206)');
  });

  it('treats "No house" as a choice with its own neutral chip', () => {
    render(<HouseFilterPanel selected="none" board="lifetime" year="all" handIds={[]} />);

    expect(screen.getByRole('link', { name: 'No house' }).getAttribute('aria-current')).toBe('page');
    const chip = screen.getByRole('link', { name: 'Remove No house filter' });
    expect(chip.style.backgroundColor).toBe('');
  });

  it('keeps the game, the year and the hand filters, and never a sheet number', () => {
    render(<HouseFilterPanel selected="rusa" board="skill" year={2026} handIds={['h8', 'h7']} variant="fei" />);

    expect(screen.getByRole('link', { name: 'Manis' }).getAttribute('href'))
      .toBe('/?board=skill&game=fei&year=2026&house=manis&hand=h7&hand=h8');
    expect(screen.getByRole('link', { name: 'Remove Rusa filter' }).getAttribute('href'))
      .toBe('/?board=skill&game=fei&year=2026&hand=h7&hand=h8');
  });
});

describe('a row on a board narrowed to a house', () => {
  it('shows the place among everyone under the place in the house', () => {
    render(<ol><BoardRow rank={2} overallRank={9} name="Hui" context="14 games" score="+96" scoreTone="gain"
      house={findHouse('orcaella')} /></ol>);

    const rank = screen.getByLabelText('Rank 2 here, 9 overall');
    expect(rank.textContent).toBe('2#9');
    // The second number inherits the house's own text colour like everything else on the row.
    for (const node of rank.querySelectorAll('*')) {
      expect(node.className).not.toMatch(/\btext-(ink|muted|gain|coral)\b/);
    }
  });

  it('shows one number when the board is not narrowed', () => {
    render(<ol><BoardRow rank={2} name="Hui" context="14 games" score="+96" scoreTone="gain" house={null} /></ol>);

    expect(screen.getByLabelText('Rank 2').textContent).toBe('2');
  });

  it('does the same for a ranked win', () => {
    const hand = { id: 'h7', name: 'All Pungs', local_name: null, rarity: 'uncommon' as const };
    render(<ol><NotableWinRow rank={1} overallRank={8} winnerName="Bryan" wonAt="2026-09-12T04:00:00Z"
      handTypes={[hand]} href="/hands/c1" /></ol>);
    expect(screen.getByText('Rank 1 here, 8 overall')).toBeTruthy();
    expect(screen.getByText('#8')).toBeTruthy();

    cleanup();
    render(<ol><NotableWinRow rank={1} winnerName="Bryan" wonAt="2026-09-12T04:00:00Z"
      handTypes={[hand]} href="/hands/c1" /></ol>);
    expect(screen.getByText('Rank 1')).toBeTruthy();
    expect(screen.queryByText(/^#/)).toBeNull();
  });
});
