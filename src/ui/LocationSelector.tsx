import { useGameStore } from '../app/gameStore';
import { getAvailability, LOCATIONS } from '../app/locations';
import { ART_SIZE, LOCATION_ICONS } from '../art/pixelArt';
import { PixelArt } from './PixelArt';

/** Persistent location selector. Locked entries stay focusable and explain why they're locked. */
export function LocationSelector() {
  const current = useGameStore((s) => s.currentLocation);
  const goTo = useGameStore((s) => s.goTo);

  return (
    <nav className="locations" aria-label="Locations">
      <ul>
        {LOCATIONS.map((loc) => {
          const availability = getAvailability(loc.id);
          const active = loc.id === current;
          const reason = availability.available ? undefined : availability.reason;
          return (
            <li key={loc.id}>
              <button
                type="button"
                className={`loc ${active ? 'active' : ''} ${reason ? 'locked' : ''}`}
                aria-current={active ? 'location' : undefined}
                aria-disabled={reason ? true : undefined}
                title={reason ?? `Go to ${loc.name}`}
                onClick={() => goTo(loc.id)}
              >
                <PixelArt name={LOCATION_ICONS[loc.id]} size={ART_SIZE.icon} className="loc-icon" />
                {reason && <span aria-hidden="true">🔒 </span>}
                {loc.name}
                {reason && <span className="sr-only"> (locked: {reason})</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
