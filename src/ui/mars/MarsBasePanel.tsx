import { useGameStore } from '../../app/gameStore';
import { plantRateKgPerDay, plantStockKg } from '../../mars/marsRules';
import { programDay } from '../../progression/research';
import { fmt } from '../flight/useFlight';

/** The propellant plant on Mars, if a cargo landing set one up. */
export function MarsBasePanel() {
  const progression = useGameStore((s) => s.progression);
  const base = progression.marsBase;
  if (!base) return null;
  const boosted = progression.tech.includes('ice-mining');
  const day = programDay(progression);
  return (
    <div className="mars-base">
      <div className="eyebrow">Mars base</div>
      <p className="small-text">
        Propellant plant at {base.siteName}: about{' '}
        {fmt(plantRateKgPerDay(base.ice, boosted) / 1000, 1)} t a day,{' '}
        {fmt(plantStockKg(base, day, boosted) / 1000)} t in storage on day {fmt(day)}. A crewed Mars
        Expedition lands next to it and refuels there for the trip home.
      </p>
    </div>
  );
}
