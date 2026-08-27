import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ChipsPage from '../../src/app/chips/page';

/**
 * The rules page is the only screen in RVMJ reachable from both the leaderboard and mid-match,
 * so it is the only one whose Back arrow cannot be a constant. These assertions are on the
 * rendered markup rather than on the helper, because the bug that prompted them was not a wrong
 * rule — it was a correct-looking page that never asked.
 *
 * The page reads no database, so it is rendered for real here with nothing mocked.
 */

const GAME = '11111111-2222-3333-4444-555555555555';

const render = async (searchParams: { game?: string }) =>
  renderToStaticMarkup(await ChipsPage({ searchParams: Promise.resolve(searchParams) }));

describe('/chips Back arrow', () => {
  it('returns a player who opened it mid-match to that match', async () => {
    expect(await render({ game: GAME })).toContain(`href="/game/${GAME}"`);
  });

  it('returns a reader who opened it from the leaderboard to the leaderboard', async () => {
    const html = await render({});
    expect(html).toContain('href="/"');
    expect(html).not.toContain('href="/game/');
  });

  it('refuses a destination smuggled in as the match id', async () => {
    const html = await render({ game: 'https://example.com' });
    expect(html).toContain('href="/"');
    expect(html).not.toContain('example.com');
  });

  it('still renders the rules themselves either way', async () => {
    const html = await render({ game: GAME });
    expect(html).toContain('Tai scale');
    expect(html).toContain('Standard chip set');
  });
});
