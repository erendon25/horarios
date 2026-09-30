// Installed before BrowserRouter mounts. A listener added inside the lazy module
// can run after the router's popstate listener and be removed during navigation.
let activeGuard = null;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", (event) => activeGuard?.(event), true);
}

export function registerCompetitionNavigationGuard(guard) {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}
