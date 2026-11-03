// Icons for the route figures (owner chose sketch A, 2026-11-03): an arrow on a slope for ascent / descent,
// a peak with a flag for the highest point, a valley for the lowest. Shared by the route dock, the pill and the
// My Routes cards. Colours come from CSS (currentColor + .si-*), sizes from the caller.
const P = {
  up: '<path d="M3 19 L14 8"/><path d="M8.5 8 H14 V13.5"/><path class="si-ground" d="M3 21.2 H21"/>',
  down: '<path d="M3 8 L14 19"/><path d="M14 13.5 V19 H8.5"/><path class="si-ground" d="M3 21.2 H21"/>',
  max: '<path class="si-hill" d="M2 20 L10 7 L13 11 L15 8 L22 20 Z"/><path class="si-flag" d="M10 7 V2.5 L13.5 3.8 L10 5"/>',
  min: '<path d="M2 5 L9 16 Q12 20 15 16 L22 5"/><circle class="si-dot" cx="12" cy="17.2" r="2"/>',
};
export const statIcon = (kind, size = 20) =>
  `<svg class="si si-${kind}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${P[kind]}</svg>`;
