const prefix = 'space-atlas:scene:';
const version = 1;

export function readSession<T>(scene: string): T | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(prefix + scene) || 'null');
    return stored?.version === version && stored.value && typeof stored.value === 'object' ? stored.value : null;
  } catch { return null; }
}

export function writeSession(scene: string, value: unknown) {
  try { sessionStorage.setItem(prefix + scene, JSON.stringify({ version, value })); }
  catch { /* Restricted or full browser storage must not block scene navigation. */ }
}

export function rememberScene(scene: string, capture: () => unknown) {
  const save = () => { try { writeSession(scene, capture()); } catch { /* Initialization may be incomplete. */ } };
  const onVisibility = () => { if (document.hidden) save(); };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('space-atlas:leaving', save);
  return () => {
    window.removeEventListener('pagehide', save);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('space-atlas:leaving', save);
  };
}
