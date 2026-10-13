# Project Status

## Current stage
**Stage 5: Flight HUD and Earth orbit.** Complete and waiting for review.

## Completed
- **Stage 0–2:** foundation; Rocket Factory with modular assembly; validation, certification, design library, progression.
- **Stage 3:** Mission Control: missions, crew, payloads, weather, a go/no-go poll and commitment.
- **Stage 5:**
  - **Flight model** (`src/flight/flightModel.ts`; pure, fixed steps):
    - Planar Earth-centred two-body motion (`orbitMath.ts`: orbital elements, Ap/Pe, period, time to apsides, path sampling).
    - Attitude: pitch relative to the local horizon, bank about the nose (tilts lift out of the plane), and visual-only yaw. Attitude slews at 8°/s with RCS and 20°/s in the air.
    - Engines with an acceleration governor (3.5 g).
    - Aerodynamics: drag area blends nose-on and side-on; lift peaks at mid angles of attack. Without flaps the ship can't hold a high angle of attack.
    - Re-entry heating: Sutton–Graves stagnation flux. Belly-first (AoA ≥ 35°) the tiles absorb heat and ablate; otherwise bare steel takes it and the ship breaks up. Shield coverage comes from the design's open heat-shield sockets.
    - Touchdown classification: gentle landing (≤ 6 m/s vertical, ≤ 4 m/s horizontal, ≤ 15° tilt), hard contact (survivable on water only), or crash.
  - **Autopilot** (`autopilot.ts`):
    - Attitude holds: prograde, retrograde, radial in/out, belly-first, manual.
    - Programs:
      - **Circularize** burns near apoapsis and stops at the eccentricity minimum.
      - **Deorbit to target** predicts the impact point by simulation, times the retrograde burn and aims slightly long.
      - **Re-entry guidance** banks to trim range.
      - **Landing burn** does a belly-flop, flips upright and runs a suicide-burn law.
    - Tuned so all three zones land within ~1 km with the reference design (shield about 93%, peak 3.5 g).
  - **Landing zones** (`landingZones.ts`): equatorial splashdown zone (±40 km), ocean platform "Kestrel" (±1.5 km), launch-site pad (±1.5 km). Simplified geography: the launch coast is land; the rest of the ground track is ocean.
  - **Flight runtime** (`flightRuntime.ts`):
    - A framework-free session from orbit insertion to debrief. Snapshots are throttled to 10 Hz, with at most 400 steps per frame.
    - Time warp: 0.05 s steps up to 10×. A coarse 1 s step (up to 1000×) is used only when coasting unpowered above 110 km. Warp drops automatically for burns, the atmosphere, near apoapsis while circularizing, and before the deorbit burn point, and says why.
    - Manual input disengages the autopilot without a jump.
    - Objectives: stable orbit (Pe ≥ 120 km), one full orbit, deorbit, survive re-entry, land or splash down safely.
    - *End flight* (confirmed) leaves the ship in space.
  - **Outcome** (`flightOutcome.ts`):
    - Landed on a pad, platform or the coast means the ship is recovered.
    - A gentle or hard splashdown on water keeps the crew safe, but the ship is lost.
    - A crash or breakup is fatal.
    - Crewed Orbital Shakedown is credited for orbit + one full orbit + a safe return.
    - Station and lunar missions record a "safe return (partial)".
    - The flight record gains an optional `landing` summary.
  - **Launch hand-off:**
    - Orbital missions that reach orbit no longer get a debrief at the pad. The runtime enters a `handoff` phase and offers *Continue to Flight / Orbit*.
    - The commitment is used up once the orbital flight is recorded.
    - The suborbital Test Flight is unchanged.
  - **Flight / Orbit location** (now unlocked; `CURRENT_STAGE = 5`):
    - Shows an empty state with next steps when nothing is flying, or *Take control in orbit* when a hand-off is waiting.
  - **Flight scene** (`src/scenes/flight/`):
    - Floating origin: the ship stays at the scene origin and the planet moves around it.
    - Earth: procedural Earth and cloud textures (seeded noise, original), a rim-lit atmosphere shell and a star field.
    - Near the ground: a flat local surface tile, the landing platform and pad props, and a target ring sized to the zone tolerance.
    - Ship: the ship-only part tree from the flown design, oriented belly-down, with engine plumes, a plasma glow scaled by heat flux and a breakup fireball.
    - Cameras: **Chase** (drag and zoom), **Orbit** (slow cinematic circle), **Map** (M; whole planet with the predicted path coloured by status, Ap/Pe, ship and zone markers).
  - **Flight HUD** (`src/ui/flight/`):
    - **Orbit panel:** position (altitude, speed, horizontal/vertical) separate from the trajectory (Ap and Pe with time to each, period, eccentricity, status badge), plus a 2D SVG orbit inset.
    - **Objectives:** next-step hint.
    - **Ship:** propellant, heat shield and hull meters; Δv; engines and throttle; pitch and bank; AoA; heating; g; shield coverage; flaps; crew.
    - **Autopilot:** zone picker with distance ahead; programs (disabled with a visible reason); attitude holds.
    - **Controls bar:** clock, pause, warp (levels above the limit are disabled with the reason), cutoff, Stage (disabled: no further stages), cameras, reset view, help, end flight.
    - **Overlays:** a guidance message strip, the help dialog (`?`) and the debrief (outcome, miss distance, recovery, orbits, shield and hull, peak heating and g, rewards, flight log).

- **Stage 4:**
  - Launch Pad: a fixed-step 2D ascent sim with seeded risk failures, a compressed countdown with checklist, hold, scrub and skip, rollout, plumes, staging and three cameras, telemetry and a debrief.
  - Save format v4 adds flight history.
  - Since Stage 5, orbital missions hand off to the Flight runtime at orbit insertion instead of being credited at the pad.

## Assumptions (documented, reversible)
- Flight physics is a simplified planar gameplay model: one orbital plane (the equator), no Earth rotation, an exponential atmosphere, lumped aerodynamics, and Sutton–Graves heating with gameplay heat capacities. The UI and footnotes say so; it is not a flight simulator.
- Out-of-plane steering isn't simulated. Yaw is visual only, and bank only reduces in-plane lift (enough to steer re-entry range).
- Geography is simplified: the launch coast is the only land on the ground track. Landing on the coast off-pad still recovers the ship; any gentle or hard contact on water is a crew-safe splashdown, but the ship is lost.
- Assisted flight is on by default (the ship starts with Circularize engaged if the orbit isn't yet stable). Any manual input hands over without a jump.
- A crew left in space via *End flight* is assumed rescued (the result is "flight ended", not credited). Breakup or a crash is fatal for the crew.
- The orbital flight isn't saved mid-flight. Reloading during a flight loses it, but the mission commitment is only used up when the flight is recorded, so you can launch again.
- A flight advances only while its location is active (the pad for the ascent, Flight / Orbit for the orbit), as in Stage 4.
- Mission readiness Δv remains a conservative estimate. The reference design reaches orbit, circularizes and lands with about 50 t of propellant to spare.

## Checks (last run)
- `npm run typecheck`, `npm run lint`, `npm run build`: pass.
- `npm test`: 160 tests pass across 16 files. New this stage (`tests/flight.test.ts`, plus updates):
  - orbit math (circular, elliptical, suborbital and escape states; path sampling; apsis timing; ascent→inertial conversion);
  - flight model (heating scaling, coarse-step orbit stability, the thrust governor, belly-first vs nose-first and unshielded re-entry, touchdown classification);
  - landing zones;
  - the assisted autopilot landing on all three zones within tolerance (hull > 90%, < 5 g);
  - outcome evaluation (credit, splashdown, crash, missing orbit, station partial, stranded);
  - warp limits and program availability reasons;
  - a full runtime run from launch hand-off to a credited RTLS landing;
  - manual takeover and *End flight*;
  - launch hand-off (no pad debrief for orbital missions);
  - landing-summary save parsing.
- Headless Chromium smoke test (manual script, not committed), with no console errors:
  - empty Flight state, then certify, crew and commit the Crewed Orbital Shakedown;
  - launch with failures off, and the hand-off dialog at orbit insertion;
  - *Continue to Flight / Orbit*, with Circularize engaged automatically;
  - chase, map and orbit cameras; the landing program shown disabled with its reason;
  - W takeover switches to manual; the help dialog opens;
  - one full orbit at 1000×, then Kestrel selected and *Deorbit to target*, with warp dropping to 10× before the burn and in the atmosphere;
  - re-entry with plasma, landing program and touchdown;
  - debrief: **Mission Success**, landed on Kestrel 1.02 km long, crew safe, shield 93%, hull 99%, peak 479 kW/m² and 3.5 g, +3 RP / +30,000 cr;
  - Mission Control afterwards; the pad is clear, since the commitment was used.

## Known limitations
- Headless software rendering is slow, so timings in the smoke test differ from real browsers.
- The booster is not recovered (Stage 6), and the ship's landing burn is assisted rather than a dedicated landing camera/challenge (Stage 6).
- The Earth texture is procedural and low-resolution (1024×512); near the ground a flat local surface tile stands in for terrain.
- Ctrl is the throttle-down key; browsers reserve some Ctrl combinations (e.g. Ctrl+W), so use the X cutoff or the buttons if in doubt.
- There's no free-fly camera, and the map view shows the predicted path but no manoeuvre planning nodes.

## Next action
Review Stage 5. When approved, begin **Stage 6: Reusable booster and ship landing** (booster return and catch or landing, landing camera, flap/leg/grid-fin animations, landing challenge).
