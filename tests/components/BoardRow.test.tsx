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
   *
   * NARROWED 2026-08-25, not relaxed. The score chip is the single permitted exception, and only
   * because it supplies its own background — anything that sets a colour while sitting DIRECTLY on
   * the house fill is still a bug. So the sweep now skips the one element carrying bg-surface and
   * checks everything else exactly as before.
   */
  it('lets the house colour reach every piece of text on the row', () => {
    row({ house: HOUSES.find((h) => h.id === 'chelonia')!, score: '-12', scoreTone: 'loss' });
    const item = screen.getByRole('listitem');

    const onTheFill = Array.from(item.querySelectorAll('*')).filter((n) => !/\bbg-surface\b/.test(n.className));
    expect(onTheFill.length).toBeGreaterThan(3); // the sweep must still be looking at something
    for (const node of onTheFill) {
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

  /**
   * The chip brings its own background, which is the whole reason the colour can come back: gain
   * and coral fail the contrast floor on ALL SEVEN house fills as bare text, but clear it on the
   * surface the chip carries. text-xl matters as much as the colour — at 20px extra-bold the score
   * counts as large text, where the floor is 3:1 and coral's 3.24:1 on surface passes. Drop it to
   * text-lg and coral silently falls below a 4.5:1 requirement.
   */
  it('gives a directional score its own surface so the colour survives any house', () => {
    for (const id of ['rusa', 'strix', 'panthera'] as const) {
      cleanup();
      row({ house: HOUSES.find((h) => h.id === id)!, score: '+44', scoreTone: 'gain' });
      const chip = screen.getByText('+44');
      expect(chip.className).toMatch(/\bbg-surface\b/);
      expect(chip.className).toMatch(/\btext-gain\b/);
      expect(chip.className).toMatch(/\btext-xl\b/);
    }

    cleanup();
    row({ house: HOUSES.find((h) => h.id === 'rusa')!, score: '-29', scoreTone: 'loss' });
    expect(screen.getByText('-29').className).toMatch(/\bbg-surface\b/);
    expect(screen.getByText('-29').className).toMatch(/\btext-coral\b/);
  });

  /** A count with no direction has nothing to signal, so it gets no chip. */
  it('leaves a directionless score plain', () => {
    row({ house: HOUSES.find((h) => h.id === 'strix')!, score: '3', scoreTone: 'neutral' });
    expect(screen.getByText('3').className).not.toMatch(/\bbg-surface\b/);
  });

  it('announces the rank', () => {
    row({ rank: 4 });
    expect(screen.getByLabelText('Rank 4').textContent).toBe('4');
  });
});
