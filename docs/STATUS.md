# Project Status

## Current stage
**Stage 4: Launch Pad and countdown.** Complete and waiting for review.

## Completed
- **Stage 0–2:** foundation; Rocket Factory with modular assembly; validation, certification, design library, progression.
- **Stage 3:** Mission Control: missions, crew, payloads, weather, a go/no-go poll and commitment.
- **Stage 4:**
  - **Ascent simulation** (`src/simulation/`; pure, fixed 0.05 s step):
    - 2D downrange × altitude over a spherical Earth, with gravity relieved by horizontal speed so circular speed means orbit.
    - Exponential atmosphere: drag, dynamic pressure and max-Q.
    - Thrust and Isp blend between sea-level and vacuum values with ambient pressure; mass flow comes from thrust and Isp.
    - Throttle laws: a max-Q bucket, then acceleration limits (4 g booster, 3.5 g ship) using per-engine shutdown.
    - Guidance: an open-loop pitch program for the booster, then closed-loop vertical-speed and altitude hold for the ship.
    - Hot staging when booster propellant runs out; the booster then falls ballistically to splashdown.
    - Ship cutoff at orbit (circular speed near 150 km) or at the suborbital profile speed, followed by a coast to apogee.
    - Outcomes: orbit, apogee, low apogee, hold-down abort (thrust below weight at T-0), out of propellant, crash, vehicle loss, aborted.
    - Flight vehicle parameters are derived from the design (`flightVehicle.ts`); payload and crew mass ride with the ship.
  - **Risk-driven failures** (`failures.ts`): booster engine-out, ship engine-out and vehicle loss. They are seeded per flight, scaled by mission risk, and can be switched off with the "Random failures" checkbox (on by default).
  - **Countdown** (`src/launch/countdown.ts`):
    - Runs from T-40:00, compressed 60× to T-1:00, 5× to T-10 s, then real time.
    - Checklist: power-up, propellant loading with progress bars, crew boarding or payload closeout, engine chill, final poll, tower arms retract, autosequence, ignition, liftoff.
    - Hold/resume, skip to T-10 s, and scrub (no penalty).
  - **Launch runtime** (`launchRuntime.ts`):
    - A framework-free state machine: rollout → pad → countdown → ascent → debrief.
    - Fixed-step accumulator capped at 400 steps per frame, pause, and time warp of 1×, 2×, 4× or 10×.
    - Abort in flight (crew safe under a simplified abort model).
    - UI snapshots are throttled to 10 Hz; the renderer reads live state every frame.
    - The flight only advances while the Launch Pad is the active location, so it pauses while you're elsewhere.
  - **Launch gating:** the pad only rolls out a vehicle with a valid Mission Control commitment. Otherwise it shows a clear empty state with the reason and a button to Mission Control. A void commitment is explained.
  - **Launch Pad scene** (`src/scenes/launch-pad/`):
    - Procedural coastal launch site: mount with clamps, flame trench and deflector, a 146 m tower with catch arms and a QD arm that swings clear at T-2:00, tank farm and pipe rack, roads, fence, procedural hills, beach and sea.
    - Animated, skippable rollout: a transporter drives the stack in and the tower lifts it onto the mount.
    - Ignition smoke cloud; additive engine plumes that grow with throttle and widen and fade with altitude.
    - At hot staging the ship detaches in 3D and the booster falls on its own trajectory.
    - Fireball on vehicle loss.
    - Curved-Earth placement; the sky fades from blue to black, with the Earth sphere, atmosphere shell and stars at altitude.
    - Dynamic near/far camera planes for large distances, and a reflection environment for the steel.
    - Cameras: **Pad** (fixed site camera with telephoto zoom), **Follow** (drag to orbit, wheel to zoom), **Cinematic** (rotating ground, beach and chase shots), plus a reset.
  - **HUD:**
    - Mission header and countdown checklist.
    - Telemetry: altitude, speed, horizontal and vertical speed, downrange, acceleration, Q and max-Q, stage and engines running, throttle and pitch, propellant per stage.
    - SVG ascent profile against the target, and an event log.
    - Mission clock with HOLD, PAUSED and warp tags.
    - Phase-dependent controls, with a two-step ABORT confirmation.
    - Shortcuts: Space hold/pause, [ ] warp, 1/2/3 cameras.
    - Debrief: result, summary, crew safety, rewards, max altitude, speed and Q, duration, and the flight log.
  - **Results** (`flightRecord.ts`, `flightSlice.ts`):
    - Uncrewed Test Flight is credited on reaching apogee.
    - Crewed Orbital Shakedown is credited on orbit insertion; return is assumed nominal until Stage 5, and this is stated in the debrief.
    - Other missions record an "ascent success (partial)".
    - Rewards are paid once. A flight uses up the commitment; a scrub keeps it so you can recycle.
  - **Save format v4:** flight history (last 30) and the random-failures preference, with a v3→v4 migration and per-record validation.
  - **Build:** Three.js and React are now split into vendor chunks (app 218 kB, React 219 kB, Three.js 610 kB minified).

## Assumptions (documented, reversible)
- The ascent model is a simplified 2D gameplay model: no Earth rotation, no 3D steering, an exponential atmosphere, and lumped stage parameters. The UI says so.
- The guidance is automatic. Manual throttle and pitch control arrive with the Flight HUD (Stage 5).
- Crew are never lost in this stage: aborts and vehicle losses are survivable thanks to a simplified ship-abort model.
- Mission readiness Δv (ideal rocket equation against a requirement with losses folded in) is a conservative check. The actual sim reaches orbit with some margin left.

## Checks (last run)
- `npm run typecheck`, `npm run lint`: pass.
- `npm test`: 139 tests pass across 15 files. New this stage:
  - flight vehicle derivation, the gravity model, orbit and suborbital success for the reference design;
  - propellant conservation, determinism, hold-down abort, overload failure;
  - engine-out and vehicle loss, abort, the acceleration limit, failure planning;
  - countdown compression and boundaries, checklist status, propellant load, clock formatting;
  - flight record crediting;
  - runtime phases, hold, scrub, pause, abort, the per-frame step cap and throttled publishing;
  - v3→v4 migration and flight history parsing;
  - store flight recording (rewards once, commitment released, scrub keeps it);
  - the launch binding (only a valid commitment launches; a void one is explained).
- `npm run build`: pass.
- Headless Chromium smoke test (manual script, not committed), with no console errors:
  - empty pad, then certify, commit the Uncrewed Test Flight and go to the Launch Pad;
  - rollout, skip, countdown, hold and resume, skip to T-10 s, liftoff with smoke;
  - Follow camera at 10× warp through max-Q, staging and space;
  - debrief shows Mission Success (145 km apogee) and rewards are paid; Mission Control shows 1 flown.

## Known limitations
- Headless software rendering is slow, so its timings differ from real browsers. Gameplay timing uses real elapsed time, capped per frame.
- The booster isn't recovered yet (Stage 6), and the ship stops at orbit insertion or apogee (re-entry and orbit flight are Stage 5).
- Camera modes are basic; there's no free-fly camera.
- The Earth is a plain blue sphere with no texture or clouds (Stage 5).

## Next action
Review Stage 4. When it is approved, begin **Stage 5: Flight HUD and Earth orbit**: manual attitude and throttle control, orbital state and map view, deorbit, re-entry and debrief, completing the build → mission → launch → orbit → return loop.
