import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BoardRow } from '../../src/components/BoardRow';
import { HOUSES } from '../../src/lib/houses';

const row = (props: Partial<Parameters<typeof BoardRow>[0]> = {}) => render(
  <ol>
    <BoardRow rank={1} name="Ah Seng" context="3 games" score="+32" scoreTone="gain" house={null} {...props} />
  </ol>,
);

const hex = (value: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

afterEach(cleanup);

describe('leaderboard row', () => {
  it('paints the whole row and names the house', () => {
    row({ house: HOUSES.find((h) => h.id === 'rusa')! });
    const item = screen.getByRole('listitem');

    expect(item.style.backgroundColor).toBe('rgb(47, 100, 79)');
    expect(item.style.color).toBe('rgb(255, 253, 248)');
    expect(screen.getByText('Rusa')).toBeTruthy();
  });

  it('renders all seven mappings exactly', () => {
    for (const house of HOUSES) {
      cleanup();
      row({ house });
      const item = screen.getByRole('listitem');
      expect(item.style.backgroundColor).toBe(hex(house.fill));
      expect(item.style.color).toBe(hex(house.text));
      expect(screen.getByText(house.name)).toBeTruthy();
    }
  });

  /**
   * The rule that makes the palette safe: on a coloured row every piece of text is the house's
   * own text colour, so nothing inside may set its own. A stray `text-muted` here would put grey
   * on Rusa's dark green.
   */
  it('lets the house colour reach every piece of text on the row', () => {
    row({ house: HOUSES.find((h) => h.id === 'chelonia')!, score: '-12', scoreTone: 'loss' });
    const item = screen.getByRole('listitem');

    for (const node of Array.from(item.querySelectorAll('*'))) {
      expect(node.className).not.toMatch(/\btext-(ink|muted|gain|coral)\b/);
    }
  });

  it('keeps the sign so score direction never depends on colour', () => {
    row({ house: HOUSES.find((h) => h.id === 'strix')!, score: '+32', scoreTone: 'gain' });
    expect(screen.getByText('+32')).toBeTruthy();

    cleanup();
    row({ house: HOUSES.find((h) => h.id === 'strix')!, score: '-32', scoreTone: 'loss' });
    expect(screen.getByText('-32')).toBeTruthy();
  });

  it('leaves a house-less row neutral and says so', () => {
    row({ house: null });
    const item = screen.getByRole('listitem');

    expect(item.style.backgroundColor).toBe('');
    expect(screen.getByText('No house yet')).toBeTruthy();
    expect(screen.getByText('Ah Seng').className).toMatch(/text-ink/);
    expect(screen.getByText('3 games').className).toMatch(/text-muted/);
  });

  it('keeps signed score tones on a house-less row', () => {
    row({ house: null, score: '+32', scoreTone: 'gain' });
    expect(screen.getByText('+32').className).toMatch(/text-gain/);

    cleanup();
    row({ house: null, score: '-32', scoreTone: 'loss' });
    expect(screen.getByText('-32').className).toMatch(/text-coral/);

    cleanup();
    row({ house: null, score: '2', scoreTone: 'neutral' });
    expect(screen.getByText('2').className).toMatch(/text-muted/);
  });

  it('announces the rank', () => {
    row({ rank: 4 });
    expect(screen.getByLabelText('Rank 4').textContent).toBe('4');
  });
});
