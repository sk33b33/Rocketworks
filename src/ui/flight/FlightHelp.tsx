/** Keyboard and mouse reference for the flight scene. */
export function FlightHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="panel help debrief" role="dialog" aria-label="Flight controls">
      <div className="panel-header">
        <h2>Flight controls</h2>
        <button type="button" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
      <dl className="facts">
        <dt>W / S</dt>
        <dd>Pitch nose up / down (manual takeover)</dd>
        <dt>Q / E</dt>
        <dd>Bank left / right (in the air, bank steers lift and shortens range)</dd>
        <dt>Shift / Ctrl</dt>
        <dd>Throttle up / down</dd>
        <dt>Z / X</dt>
        <dd>Full throttle / engine cutoff</dd>
        <dt>Space</dt>
        <dd>Pause / resume</dd>
        <dt>. / ,</dt>
        <dd>
          Time warp up / down (up to 10× while burning or in the air, 1000× coasting above 110 km)
        </dd>
        <dt>1 / 2 / M</dt>
        <dd>Chase / orbit / map camera</dd>
        <dt>Mouse</dt>
        <dd>Drag to look around, wheel to zoom</dd>
      </dl>
      <p className="small-text muted">
        The autopilot can fly the whole mission: Circularize → coast one orbit → Deorbit to target →
        Re-entry guidance → Landing burn. Any manual input hands control back to you. Simplified
        gameplay physics, not a flight simulator.
      </p>
    </div>
  );
}
