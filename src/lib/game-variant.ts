/**
 * Which GAME a match was, as opposed to how it was scored. Regular and 8 Fei are played with the
 * same chips and counted the same way, but they are separate ladders: a match saved as one never
 * counts on the other's boards (Bryan, 2026-10-07).
 *
 * The keys are what the database stores (`games.variant`, migration 0016) and what the address
 * carries, so they must not change. The titles are only what a player reads, and are free to.
 * "Regular" in particular is a working name for the game the app has always tracked.
 */
export const GAME_VARIANTS = {
  regular: { title: 'Regular' },
  fei: { title: '8 Fei' },
} as const;

export type GameVariant = keyof typeof GAME_VARIANTS;

/** Every match saved before variants existed, and every address written before they did. */
export const DEFAULT_VARIANT: GameVariant = 'regular';

/** The name the address uses. A board link reads `?game=fei`; the regular game is no parameter. */
export const VARIANT_PARAM = 'game';

export function isGameVariant(raw: unknown): raw is GameVariant {
  return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(GAME_VARIANTS, raw);
}

/**
 * Anything that is not exactly one known variant is the regular game: same fail-soft posture the
 * `board` parameter takes, so a hand-typed address lands on a real board instead of an error
 * page. A repeated parameter is malformed rather than a choice, and is treated as absent.
 */
export function normalizeVariant(raw: string | string[] | undefined): GameVariant {
  return isGameVariant(raw) ? raw : DEFAULT_VARIANT;
}

/** "8 Fei game", "Regular game": how a finished match says which ladder it went on. */
export function variantGameLabel(variant: GameVariant): string {
  return `${GAME_VARIANTS[variant].title} game`;
}
