export const ISRAEL_REFERENCE_POINTS = [
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
