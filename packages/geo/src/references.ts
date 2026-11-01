import type { ReferencePoint } from './dem.ts';

/**
 * Known elevations for the DEM encoding check (SPEC P10.5). Checked 2026-11-01.
 *
 * Ranges are wide enough for a 10–30 m DEM and for imprecise published coordinates, and far too
 * narrow for a wrong encoding to pass: decoding Terrarium pixels as "mapbox" gives values off by
 * hundreds of kilometres, so any sign or scale error fails loudly.
 *
 * `searchRadiusM`: published summit coordinates are rounded (Meron: 33°00′N 35°25′E ≈ ±900 m), so for
 * a summit the check takes the MAXIMUM elevation within this radius instead of a single point.
 */
export interface IsraelReference extends ReferencePoint {
  searchRadiusM?: number;
  mode: 'point' | 'max-within';
}

export const ISRAEL_REFERENCE_POINTS: readonly IsraelReference[] = [
  {
    name: 'Har Meron summit',
    point: [35.4167, 33.0],
    mode: 'max-within',
    searchRadiusM: 1200,
    // published 1,208 m; a 10 m DEM can shave a sharp summit by a few metres
    min: 1170,
    max: 1225,
    source: 'Wikipedia "Mount Meron": 1,208 m, 33°00′N 35°25′E (fetched 2026-11-01)',
  },
  {
    name: 'Mediterranean coast, Tel Aviv beach',
    point: [34.7668, 32.0836],
    mode: 'point',
    min: -5,
    max: 15,
    source: 'Sandy beach at sea level; point chosen ~40 m inland of the waterline',
  },
  {
    name: 'Dead Sea, northern basin water surface',
    point: [35.5, 31.6],
    mode: 'point',
    // Water surface was ≈ −439.8 m in April 2026 (Jerusalem Post, 2026-04-25), but the Israel DEM
    // (isr10, ASTER GDEM based) reflects the level at acquisition time, years earlier (higher).
    min: -450,
    max: -390,
    source: 'Jerusalem Post 2026-04-25: surface ≈ −439.8 m; DEM date older → range widened upward',
  },
];
