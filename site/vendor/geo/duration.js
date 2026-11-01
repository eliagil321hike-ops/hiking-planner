/**
 * Walking-time ESTIMATES (SPEC §9.2). Always label results as estimates in the UI.
 *
 * Naismith (default): 5 km/h on the horizontal distance, plus 1 hour per 600 m of ascent.
 * Descent is ignored. No rest stops, no terrain or fitness factor.
 */
export function naismithSeconds(distanceM, ascentM) {
    if (!(distanceM >= 0) || !(ascentM >= 0))
        throw new RangeError('distance and ascent must be ≥ 0');
    const horizontalH = distanceM / 5000;
    const climbH = ascentM / 600;
    return (horizontalH + climbH) * 3600;
}
/**
 * Tobler's hiking function, for comparison only: speed (km/h) = 6 · exp(-3.5 · |slope + 0.05|),
 * applied per segment. `segments` are [horizontal distance m, elevation change m].
 */
export function toblerSeconds(segments) {
    let s = 0;
    for (const [d, dz] of segments) {
        if (d <= 0)
            continue;
        const slope = dz / d;
        const kmh = 6 * Math.exp(-3.5 * Math.abs(slope + 0.05));
        s += (d / 1000 / kmh) * 3600;
    }
    return s;
}
