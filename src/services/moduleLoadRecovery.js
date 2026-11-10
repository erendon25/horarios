// Reload once when an open tab requests a module removed by a deployment.
// A persistent network failure must not cause a reload loop.
export function installModuleLoadRecovery(target = window, now = Date.now) {
  const key = 'module-load-recovery-at';
  const listener = (event) => {
    try {
      const previous = Number(target.sessionStorage.getItem(key));
      const timestamp = now();
      if (previous && timestamp - previous < 60_000) return;
      target.sessionStorage.setItem(key, String(timestamp));
      event.preventDefault();
      target.location.reload();
    } catch {
      // The error boundary offers a manual retry when storage is unavailable.
    }
  };
  target.addEventListener('vite:preloadError', listener);
  return () => target.removeEventListener('vite:preloadError', listener);
}
