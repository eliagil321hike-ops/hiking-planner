/**
 * Elevation statistics (SPEC §9.1). Parameters, documented as required:
 *  - Sampling interval: caller resamples the route every ~10–25 m (see resampleLine); default 20 m.
 *  - Missing data: null elevations. Runs of ≤ maxGap (default 3) consecutive nulls BETWEEN valid
 *    samples are filled by linear interpolation. Longer runs, or nulls at the ends, are left as null
 *    and the result is flagged `incomplete` with the missing index ranges. Null is NEVER treated as 0.
 *  - Smoothing: centred moving average over an odd number of samples covering ≈ windowM metres
 *    (default 80 m → 5 samples at 20 m). Window shrinks symmetrically near the ends; endpoints kept.
 *    Smoothing never crosses a missing stretch.
 *  - Ascent/descent: hysteresis with threshold T (default 3 m). Small wiggles never accumulate,
 *    slow steady climbs do. Restarts at every missing stretch.
 *  - Min/max: from smoothed valid samples; raw min/max are also returned.
 */
export const DEFAULT_STATS_OPTIONS = {
    stepM: 20,
    windowM: 80,
    thresholdM: 3,
    maxGap: 3,
};
/** Fill short interior gaps by linear interpolation. Returns filled copy and remaining missing ranges. */
export function fillGaps(e, maxGap) {
    const filled = e.map((v) => (v === null || !Number.isFinite(v) ? null : v));
    const missing = [];
    let i = 0;
    while (i < filled.length) {
        if (filled[i] !== null) {
            i++;
            continue;
        }
        const start = i;
        while (i < filled.length && filled[i] === null)
            i++;
        const end = i - 1;
        const len = end - start + 1;
        const before = start - 1, after = i;
        if (before >= 0 && after < filled.length && len <= maxGap) {
            const a = filled[before], b = filled[after];
            for (let k = start; k <= end; k++)
                filled[k] = a + ((b - a) * (k - before)) / (after - before);
        }
        else {
            missing.push([start, end]);
        }
    }
    return { filled, missing };
}
/** Centred moving average with an odd window (in samples); does not cross nulls. */
export function smooth(e, windowSamples) {
    const w = Math.max(1, windowSamples % 2 === 0 ? windowSamples + 1 : windowSamples);
    const half = (w - 1) / 2;
    const out = new Array(e.length).fill(null);
    for (let i = 0; i < e.length; i++) {
        if (e[i] === null)
            continue;
        // shrink the window symmetrically until it fits inside a run of valid samples
        let h = half;
        while (h > 0) {
            let ok = i - h >= 0 && i + h < e.length;
            for (let k = i - h; ok && k <= i + h; k++)
                if (e[k] === null)
                    ok = false;
            if (ok)
                break;
            h--;
        }
        let sum = 0;
        for (let k = i - h; k <= i + h; k++)
            sum += e[k];
        out[i] = sum / (2 * h + 1);
    }
    return out;
}
/**
 * Peak/valley hysteresis over one contiguous run of valid values (DECISIONS D-005).
 * Tracks the running extreme in the current direction; a reversal is confirmed only when the value
 * moves ≥ T back from that extreme, and the full leg (extreme − previous extreme) is then credited.
 * Properties: oscillations smaller than T never count; slow steady climbs count fully; unlike the
 * literal SPEC §9.1 pseudocode (anchor stepping), it does not lose up to T at every turning point.
 */
export function hysteresis(e, T) {
    if (e.length === 0)
        return { ascent: 0, descent: 0 };
    let ascent = 0, descent = 0;
    let base = e[0]; // last confirmed turning point (or start)
    let dir = 0; // 0 = undecided
    let extreme = e[0]; // running max (dir=1) or min (dir=-1)
    for (let i = 1; i < e.length; i++) {
        const v = e[i];
        if (dir === 0) {
            if (v - base >= T) {
                dir = 1;
                extreme = v;
            }
            else if (base - v >= T) {
                dir = -1;
                extreme = v;
            }
        }
        else if (dir === 1) {
            if (v > extreme)
                extreme = v;
            else if (extreme - v >= T) {
                ascent += extreme - base;
                base = extreme;
                dir = -1;
                extreme = v;
            }
        }
        else {
            if (v < extreme)
                extreme = v;
            else if (v - extreme >= T) {
                descent += base - extreme;
                base = extreme;
                dir = 1;
                extreme = v;
            }
        }
    }
    // Finalize: credit the open leg if it reached T.
    if (dir === 1 && extreme - base >= T)
        ascent += extreme - base;
    else if (dir === -1 && base - extreme >= T)
        descent += base - extreme;
    return { ascent, descent };
}
/** Literal SPEC §9.1 pseudocode (anchor stepping). Kept for comparison tests only. */
export function anchorSteppingHysteresis(e, T) {
    if (e.length === 0)
        return { ascent: 0, descent: 0 };
    let anchor = e[0];
    let ascent = 0, descent = 0;
    for (let i = 1; i < e.length; i++) {
        const v = e[i];
        if (v - anchor >= T) {
            ascent += v - anchor;
            anchor = v;
        }
        else if (anchor - v >= T) {
            descent += anchor - v;
            anchor = v;
        }
    }
    return { ascent, descent };
}
/** Naive per-step threshold method (the v1 bug). Exported ONLY so tests can prove it is wrong. */
export function perStepThresholdAscent(e, T) {
    let a = 0;
    for (let i = 1; i < e.length; i++)
        if (e[i] - e[i - 1] >= T)
            a += e[i] - e[i - 1];
    return a;
}
export function computeElevationStats(elevations, options = {}) {
    const params = { ...DEFAULT_STATS_OPTIONS, ...options };
    if (!(params.stepM > 0) || !(params.thresholdM > 0))
        throw new RangeError('stepM and thresholdM must be > 0');
    const { filled, missing } = fillGaps(elevations, params.maxGap);
    let windowSamples = Math.round(params.windowM / params.stepM);
    if (windowSamples % 2 === 0)
        windowSamples += 1;
    const smoothed = smooth(filled, windowSamples);
    let ascent = 0, descent = 0;
    let run = [];
    const flush = () => {
        const r = hysteresis(run, params.thresholdM);
        ascent += r.ascent;
        descent += r.descent;
        run = [];
    };
    for (const v of smoothed) {
        if (v === null)
            flush();
        else
            run.push(v);
    }
    flush();
    const valid = smoothed.filter((v) => v !== null);
    const raw = elevations.filter((v) => v !== null && Number.isFinite(v));
    return {
        ascent,
        descent,
        min: valid.length ? Math.min(...valid) : null,
        max: valid.length ? Math.max(...valid) : null,
        rawMin: raw.length ? Math.min(...raw) : null,
        rawMax: raw.length ? Math.max(...raw) : null,
        incomplete: missing.length > 0,
        missing,
        smoothed,
        params,
    };
}
