import type { ReferencePoint } from './dem.ts';

/**
 * Known elevations used by the DEM encoding check (SPEC P10.5).
 * TODO(Phase 0): replace with researched, sourced values. Ranges are deliberately wide enough
 * for a 10–30 m DEM, and far too narrow for a wrong encoding to pass by accident.
 */
export const ISRAEL_REFERENCE_POINTS: readonly ReferencePoint[] = [];
