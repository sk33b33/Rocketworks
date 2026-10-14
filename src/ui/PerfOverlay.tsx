import { useEffect, useState } from 'react';
import { perfProbe, type PerfSnapshot } from '../game/PerfStats';

/** Optional performance readout (Settings → Show performance stats). */
export function PerfOverlay() {
  const [s, setS] = useState<PerfSnapshot | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setS(perfProbe.stats?.current ?? null), 500);
    return () => window.clearInterval(id);
  }, []);
  if (!s) return null;
  return (
    <div className="perf-overlay" role="status" aria-label="Performance statistics">
      <span>
        {s.fps.toFixed(0)} fps · {s.frameMs.toFixed(1)} ms
      </span>
      <span>
        update {s.updateMs.toFixed(1)} · render {s.renderMs.toFixed(1)} ms
      </span>
      <span>
        {s.calls} draws · {(s.triangles / 1000).toFixed(0)}k tris
      </span>
      <span>
        {s.geometries} geometries · {s.textures} textures
      </span>
    </div>
  );
}
