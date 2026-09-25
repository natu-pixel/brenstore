import { useEffect, useState } from 'react';

// autostart=1 plays the model without the viewer's click-to-start button.
const SKETCHFAB_EMBED_SRC = 'https://sketchfab.com/models/17950505a83d4c339fd276c6b3a8addc/embed?autostart=1&ui_stop=0&ui_hint=0';

/**
 * Official Sketchfab iframe embed of the hero character. Used directly on
 * slow/unsupported devices and as the fallback when the self-hosted GLB is
 * unavailable. Mounts one tick after first paint so the third-party viewer
 * never blocks page load.
 */
export default function SketchfabEmbed() {
  const [load, setLoad] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoad(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return load ? (
    <iframe
      className="hero-embed-frame"
      title="Female Cowgirl V4 — interactive 3D character"
      src={SKETCHFAB_EMBED_SRC}
      allow="autoplay; fullscreen; xr-spatial-tracking"
      allowFullScreen
    />
  ) : (
    <div className="hero-embed-frame hero-embed-placeholder" role="status" aria-label="Loading the 3D model" />
  );
}
