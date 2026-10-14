import { flightRuntime } from '../../app/flightBinding';
import { HAZARD_LABELS, LUNAR_SITES, SiteTerrain } from '../../moon/lunarSites';
import type { LunarView } from '../../moon/lunarFlight';
import { TerrainStrip } from './TerrainStrip';

const steepCache = new Map<string, number>();
/** Share of ground steeper than 9° within 500 m of a site's target (cached; terrain is fixed). */
function steep(id: string): number {
  let v = steepCache.get(id);
  if (v === undefined) {
    const site = LUNAR_SITES.find((s) => s.id === id)!;
    v = new SiteTerrain(site).steepShare();
    steepCache.set(id, v);
  }
  return v;
}

/** Landing site choice (until the descent starts), with hazards and a terrain preview. */
export function SitePicker({ lunar }: { lunar: LunarView }) {
  const locked = !lunar.canChangeSite;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Landing site</h2>
        <span className="badge">{locked ? 'LOCKED' : 'CHOOSE'}</span>
      </div>
      <fieldset className="zone-picker" disabled={locked}>
        <legend className="sr-only">Landing site</legend>
        {LUNAR_SITES.map((site) => (
          <label key={site.id} className="zone-option" title={site.description}>
            <input
              type="radio"
              name="lunar-site"
              checked={lunar.site.id === site.id}
              onChange={() => flightRuntime.setLunarSite(site.id)}
            />
            <span>
              {site.name}{' '}
              <span
                className={`badge ${site.hazard === 'low' ? 'tone-ok' : site.hazard === 'moderate' ? 'tone-warn' : 'tone-bad'}`}
              >
                {HAZARD_LABELS[site.hazard]}
              </span>
              <span className="muted small-text">
                {' '}
                · {Math.round(steep(site.id) * 100)}% steep ground near the target
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="small-text">{lunar.site.description}</p>
      <p className="small-text muted">{lunar.site.lighting}</p>
      <TerrainStrip terrain={lunar.terrain} fromM={-1_500} toM={1_500} />
      {locked && (
        <p className="small-text muted">The site is fixed once the descent has started.</p>
      )}
    </div>
  );
}
