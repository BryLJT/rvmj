import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NotableWinDetail } from '../../src/components/NotableWinDetail';
import type { HandType } from '../../src/components/HandTypeFilter';
import { findHouse } from '../../src/lib/houses';

const pure: HandType = { id: 'h8', name: 'Pure Suit', local_name: '清一色', rarity: 'rare' };
const thirteen: HandType = { id: 'h1', name: 'Thirteen Wonders', local_name: '十三幺', rarity: 'legendary' };
const noLocal: HandType = { id: 'h9', name: 'Nine Gates', local_name: null, rarity: 'legendary' };

afterEach(cleanup);

describe('NotableWinDetail', () => {
  /** 17:30 UTC is 01:30 the next morning in Singapore — the tail of a long night. */
  it('shows the winner and the Singapore date', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('Ah Seng')).toBeTruthy();
    expect(screen.getByText('28 Aug 2026')).toBeTruthy();
  });

  /** The board row shows English only; this page is where the local name fits. */
  it('shows every label with its local name', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure, thirteen]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('Pure Suit')).toBeTruthy();
    expect(screen.getByText('清一色')).toBeTruthy();
    expect(screen.getByText('Thirteen Wonders')).toBeTruthy();
    expect(screen.getByText('十三幺')).toBeTruthy();
  });

  it('shows a label that has no local name without an empty bracket', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[noLocal]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('Nine Gates')).toBeTruthy();
    expect(screen.queryByText('()')).toBeNull();
  });

  /**
   * The approved fill/text pairs pass contrast only AS PAIRS, so the colour is set once on the
   * container and no child in that branch carries a colour of its own. Same rule as BoardRow.
   */
  it('paints the winner in their house colour and names the house', () => {
    const { container } = render(<NotableWinDetail winnerName="Bryan Lim" house={findHouse('orcaella')}
      wonAt="2026-08-27T17:30:00Z" handTypes={[pure]} photo={{ kind: 'none' }} />);

    const painted = container.querySelector('[style*="background-color"]') as HTMLElement;
    expect(painted.style.backgroundColor).toBe('rgb(242, 181, 206)');
    expect(painted.style.color).toBe('rgb(20, 45, 55)');
    expect(screen.getByText('Orcaella')).toBeTruthy();
  });

  it('says so when the winner has no house', () => {
    render(<NotableWinDetail winnerName="rachel" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'none' }} />);

    expect(screen.getByText('No house yet')).toBeTruthy();
  });

  it('shows the photo when there is one', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'ready', url: 'https://signed.example/a.webp' }} />);

    const image = screen.getByRole('img', { name: /Pure Suit won by Ah Seng/ }) as HTMLImageElement;
    expect(image.src).toBe('https://signed.example/a.webp');
  });

  it('says no photo was taken when the win has none', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'none' }} />);

    expect(screen.getByText(/No photo was taken/i)).toBeTruthy();
  });

  /**
   * The rule this component exists to enforce. A photo that failed to load is a DIFFERENT fact
   * from a win nobody photographed, and rendering them the same way would later invite someone to
   * "add" a photo to a win that already has one.
   */
  it('reports a failed photo and never falls through to the no-photo state', () => {
    render(<NotableWinDetail winnerName="Ah Seng" house={null} wonAt="2026-08-27T17:30:00Z"
      handTypes={[pure]} photo={{ kind: 'failed' }} />);

    expect(screen.getByText(/photo couldn’t be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/No photo was taken/i)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
