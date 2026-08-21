import { describe, expect, it } from 'vitest';
import {
  HOUSES, HOUSE_IDS, HOUSE_SETUP_PARAM, NO_HOUSE_LABEL,
  appendHouseMarker, findHouse, isHouseId, stripHouseMarker,
} from '../src/lib/houses';

/**
 * The palette is a product decision, not an implementation detail: softened and transparency
 * variants were explicitly rejected. Asserting the whole table by value is the point — a test
 * that only counted seven entries would stay green after someone "tidied" a hex code.
 */
describe('house catalogue', () => {
  it('contains exactly the seven approved mappings', () => {
    expect(HOUSES).toEqual([
      { id: 'manis', name: 'Manis', fill: '#BFE3F2', text: '#142D37' },
      { id: 'strix', name: 'Strix', fill: '#F7D968', text: '#142D37' },
      { id: 'aonynx', name: 'Aonynx', fill: '#D3D7D5', text: '#142D37' },
      { id: 'orcaella', name: 'Orcaella', fill: '#F2B5CE', text: '#142D37' },
      { id: 'rusa', name: 'Rusa', fill: '#2F644F', text: '#FFFDF8' },
      { id: 'chelonia', name: 'Chelonia', fill: '#2E4F76', text: '#FFFDF8' },
      { id: 'panthera', name: 'Panthera', fill: '#E8873A', text: '#142D37' },
    ]);
  });

  it('stores lowercase identifiers and shows capitalised display names', () => {
    for (const house of HOUSES) {
      expect(house.id).toBe(house.id.toLowerCase());
      expect(house.name).toBe(house.id[0].toUpperCase() + house.id.slice(1));
    }
  });

  it('lists the ids in catalogue order', () => {
    expect(HOUSE_IDS).toEqual(['manis', 'strix', 'aonynx', 'orcaella', 'rusa', 'chelonia', 'panthera']);
  });

  it('accepts only the seven identifiers', () => {
    for (const id of HOUSE_IDS) expect(isHouseId(id)).toBe(true);
    for (const bogus of ['MANIS', 'Manis', 'manis ', 'gryffindor', '', null, undefined, 7, {}]) {
      expect(isHouseId(bogus)).toBe(false);
    }
  });

  it('looks a house up, and answers null for no house at all', () => {
    expect(findHouse('rusa')).toEqual({ id: 'rusa', name: 'Rusa', fill: '#2F644F', text: '#FFFDF8' });
    expect(findHouse(null)).toBeNull();
    expect(findHouse(undefined)).toBeNull();
    expect(findHouse('gryffindor')).toBeNull();
  });

  it('names the marker and the house-less label once, here', () => {
    expect(HOUSE_SETUP_PARAM).toBe('houseSetup');
    expect(NO_HOUSE_LABEL).toBe('No house yet');
  });
});

/**
 * These are string surgery, not URL round-tripping, and that is deliberate. Passing the
 * destination through URLSearchParams would re-serialise every parameter, quietly turning
 * `?a` into `?a=`. The spec says adding or removing the marker must not touch any unrelated
 * part of the destination.
 */
describe('the houseSetup marker', () => {
  it('appends to a bare path', () => {
    expect(appendHouseMarker('/')).toBe('/?houseSetup=1');
    expect(appendHouseMarker('/chips')).toBe('/chips?houseSetup=1');
  });

  it('joins an existing query without rewriting it', () => {
    expect(appendHouseMarker('/?board=skill')).toBe('/?board=skill&houseSetup=1');
    expect(appendHouseMarker('/g?a&b=2')).toBe('/g?a&b=2&houseSetup=1');
  });

  it('stays in front of a fragment', () => {
    expect(appendHouseMarker('/g#seat-E')).toBe('/g?houseSetup=1#seat-E');
    expect(appendHouseMarker('/g?a=1#seat-E')).toBe('/g?a=1&houseSetup=1#seat-E');
  });

  it('removes only itself', () => {
    expect(stripHouseMarker('?houseSetup=1')).toBe('');
    expect(stripHouseMarker('?board=skill&houseSetup=1')).toBe('?board=skill');
    expect(stripHouseMarker('?houseSetup=1&board=skill')).toBe('?board=skill');
    expect(stripHouseMarker('?a&b=2&houseSetup=1')).toBe('?a&b=2');
  });

  it('leaves a destination that never carried the marker exactly as it was', () => {
    expect(stripHouseMarker('?board=skill')).toBe('?board=skill');
    expect(stripHouseMarker('')).toBe('');
    expect(stripHouseMarker('?')).toBe('');
  });

  it('removes a bare or re-valued marker too', () => {
    expect(stripHouseMarker('?houseSetup')).toBe('');
    expect(stripHouseMarker('?houseSetup=0&board=skill')).toBe('?board=skill');
  });
});
