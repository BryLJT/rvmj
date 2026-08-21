/**
 * The application source for house labels and colours. The database constrains the STORED
 * values independently (see migration 0006), so this list and that check constraint are two
 * separate guards over the same seven identifiers; 0006's assertions fail if they drift.
 *
 * No 'use server' here, and no React: this module is imported by the route handler, the server
 * action, server components, and client components alike.
 */
export type HouseId = 'manis' | 'strix' | 'aonynx' | 'orcaella' | 'rusa' | 'chelonia' | 'panthera';

export type House = { id: HouseId; name: string; fill: string; text: string };

/** Exact approved palette. Softened and transparency variants were rejected. Do not adjust. */
export const HOUSES: readonly House[] = [
  { id: 'manis', name: 'Manis', fill: '#BFE3F2', text: '#142D37' },
  { id: 'strix', name: 'Strix', fill: '#F7D968', text: '#142D37' },
  { id: 'aonynx', name: 'Aonynx', fill: '#D3D7D5', text: '#142D37' },
  { id: 'orcaella', name: 'Orcaella', fill: '#F2B5CE', text: '#142D37' },
  { id: 'rusa', name: 'Rusa', fill: '#2F644F', text: '#FFFDF8' },
  { id: 'chelonia', name: 'Chelonia', fill: '#2E4F76', text: '#FFFDF8' },
  { id: 'panthera', name: 'Panthera', fill: '#E8873A', text: '#142D37' },
];

export const HOUSE_IDS: readonly HouseId[] = HOUSES.map((house) => house.id);

/** The temporary marker the OAuth callback adds and the prompt provider strips. */
export const HOUSE_SETUP_PARAM = 'houseSetup';

export const NO_HOUSE_LABEL = 'No house yet';

export function isHouseId(value: unknown): value is HouseId {
  return typeof value === 'string' && (HOUSE_IDS as readonly string[]).includes(value);
}

export function findHouse(id: string | null | undefined): House | null {
  return HOUSES.find((house) => house.id === id) ?? null;
}

/**
 * Append the marker without disturbing the destination. Deliberately textual: URLSearchParams
 * would re-serialise the whole query, and the destination is a URL the app already sanitised.
 */
export function appendHouseMarker(path: string): string {
  const hashAt = path.indexOf('#');
  const beforeHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const separator = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${separator}${HOUSE_SETUP_PARAM}=1${hash}`;
}

/** Remove only the marker from a `location.search`, keeping every other parameter verbatim. */
export function stripHouseMarker(search: string): string {
  const kept = search.replace(/^\?/, '').split('&')
    .filter((part) => part !== '' && part.split('=')[0] !== HOUSE_SETUP_PARAM);
  return kept.length ? `?${kept.join('&')}` : '';
}
