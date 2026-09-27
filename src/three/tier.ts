export type RenderTier = 'high' | 'low';

/** Decide whether the device should download and run the 3D hero at all. */
export function detectRenderTier(): RenderTier {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low';
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return 'low';
    if ((nav.hardwareConcurrency ?? 4) < 4) return 'low';
    if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return 'low';
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'low';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return 'high';
  } catch {
    return 'low';
  }
}
