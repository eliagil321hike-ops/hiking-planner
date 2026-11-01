export class CoordinateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CoordinateError';
    }
}
export function isValidLonLat(p) {
    if (!Array.isArray(p) || p.length < 2)
        return false;
    const [lon, lat] = p;
    return (Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90);
}
/** Throws if the point is not a valid [lon, lat]. Use at every boundary (UI taps, GPX, network). */
export function assertLonLat(p, context = 'point') {
    if (!isValidLonLat(p)) {
        throw new CoordinateError(`${context}: invalid [lon, lat] ${JSON.stringify(p)}`);
    }
}
/** Build a [lon, lat] from named values; the only safe way to convert from lat/lon sources (GPX, UI). */
export function fromLatLon(lat, lon) {
    const p = [lon, lat];
    assertLonLat(p, 'fromLatLon');
    return p;
}
/**
 * Heuristic guard for a common bug in Israel: swapped order. Israel is lon ≈ 34–36, lat ≈ 29–33.5.
 * A point inside the "swapped Israel" box (lon 29–33.5, lat 34–36) is almost certainly swapped.
 */
export function looksSwappedForIsrael(p) {
    const [lon, lat] = p;
    return lon >= 29 && lon <= 33.5 && lat >= 34 && lat <= 36.5;
}
