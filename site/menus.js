// Toolbar menus (owner request D-029): an icon opens its menu, the same icon closes it; opening one menu closes
// the other. Escape closes; a click on the map closes an open menu (unless a route is being drawn, where
// map clicks add points and the menu may stay open).

export function initMenus(ctx) {
  const { $, map } = ctx;
  const menus = { 'btn-style': 'menu-style', 'btn-layers': 'menu-layers' };   // the route button opens the route dock (route.js)

  function setOpen(btnId, open) {
    $(btnId).setAttribute('aria-expanded', String(open));
    $(menus[btnId]).hidden = !open;
  }
  function toggle(btnId) {
    const open = $(menus[btnId]).hidden;
    for (const b of Object.keys(menus)) setOpen(b, b === btnId ? open : false);
  }
  const closeAll = () => Object.keys(menus).forEach((b) => setOpen(b, false));

  for (const b of Object.keys(menus)) $(b).addEventListener('click', () => toggle(b));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  map.on('click', () => { if (!ctx.isPlanning?.()) closeAll(); });

  return { open: (b) => { closeAll(); setOpen(b, true); }, closeAll };
}
