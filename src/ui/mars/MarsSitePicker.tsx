import { flightRuntime } from '../../app/flightBinding';
import { HAZARD_LABELS } from '../../moon/lunarSites';
import type { MarsView } from '../../mars/marsFlight';
import { MARS_SITES, marsTerrain } from '../../mars/marsSites';
import { plantRateKgPerDay } from '../../mars/marsRules';
import { TerrainStrip } from '../moon/TerrainStrip';
import { fmt } from '../flight/useFlight';

const steepCache = new Map<string, number>();
function steep(id: string): number {
  let v = steepCache.get(id);
  if (v === undefined) {
    v = marsTerrain(MARS_SITES.find((s) => s.id === id)!).steepShare();
    steepCache.set(id, v);
  }
  return v;
}

const elevation = (m: number) => `${m > 0 ? '+' : ''}${fmt(m / 1000, 1)} km`;

/** Mars landing site choice (until the approach is set): elevation, hazards, ice. */
export function MarsSitePicker({ mars }: { mars: MarsView }) {
  const locked = !mars.canChangeSite;
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Landing site</h2>
        <span className="badge">{mars.plan.crewed ? 'PLANT' : locked ? 'LOCKED' : 'CHOOSE'}</span>
      </div>
      <fieldset className="zone-picker" disabled={locked}>
        <legend className="sr-only">Mars landing site</legend>
        {MARS_SITES.map((site) => (
          <label key={site.id} className="zone-option" title={site.description}>
            <input
              type="radio"
              name="mars-site"
              checked={mars.site.id === site.id}
              onChange={() => flightRuntime.setMarsSite(site.id)}
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
                · elevation {elevation(site.elevationM)} · {Math.round(steep(site.id) * 100)}% steep
                ground · plant {fmt(plantRateKgPerDay(site.ice) / 1000, 1)} t/day
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="small-text">{mars.site.description}</p>
      <p className="small-text muted">{mars.site.science}</p>
      <TerrainStrip terrain={mars.terrain} fromM={-1_500} toM={1_500} />
      <p className="small-text muted">
        {mars.plan.crewed
          ? `The crew lands next to the propellant plant at ${mars.site.name} (within 2 km to run a propellant line).`
          : locked
            ? 'The approach has been set for this site.'
            : 'Higher ground has less air to slow down in: the landing burn starts faster and uses more propellant. The site is fixed by the approach correction after arriving at Mars.'}
      </p>
    </div>
  );
}
