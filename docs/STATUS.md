# Project Status

## Current stage
**Stage 7: Orbital station rendezvous and docking.** Complete and waiting for review.

## Completed
- **Stage 0–2:** foundation; Rocket Factory with modular assembly; validation, certification, design library, progression.
- **Stage 3:** Mission Control: missions, crew, payloads, weather, a go/no-go poll and commitment.
- **Stage 4:** Launch Pad, countdown and a fixed-step 2D ascent with seeded failures.
- **Stage 5:** Flight / Orbit:
  - a planar orbit and re-entry model with heating;
  - assisted programs (circularize, deorbit to a zone, re-entry guidance, landing burn) with manual takeover;
  - time warp with safety limits;
  - a procedural Earth with chase, orbit and map cameras;
  - the orbit and ship HUD, objectives and debrief.

  Orbital missions hand off from the pad at orbit insertion.
- **Stage 6:**
  - **Booster recovery planning** (`src/recovery/recoveryPlan.ts`):
    - Three options: **tower catch** (return to launch site), **ocean platform** landing downrange, or **expend**.
    - Propellant held back at staging: 15% for a catch, 6% for the platform. The ascent stages earlier (`boosterReserveKg`), and the Δv estimate in Mission Control accounts for it.
    - Hardware rules: a catch needs 4 grid fins (the arms catch on the fin hardpoints); the platform also needs 4 booster legs.
  - **Booster model** (`boosterModel.ts`):
    - A 2D return in the ascent frame: tail-first drag, grid-fin lateral steering and engine throttling with a 4 g governor.
    - Engine-bay heat load: the booster is lost above 9 MJ/m².
    - Capture window for a catch: ±12 m, ≤ 4 m/s down, ≤ 3 m/s drift, ≤ 8° tilt. Platform touchdown: on the 90 m deck at ≤ 6 m/s with legs down.
  - **Booster guidance** (`boosterGuidance.ts`):
    - Phases: separation, flip, boostback (catch only, aimed with an impact prediction), coast, a capped entry burn, grid-fin glide and landing burn.
    - **Tower catch:** a drag-aware powered-descent guidance law that re-plans every step. The landing burn lights when, a moment later, no flyable plan would remain.
    - **Platform:** a retro "suicide burn" with drag-aware ignition. The platform is stationed where the assisted profile comes down, as real droneships are positioned before launch.
    - Assisted results with the reference design: catches within about 1 m at 1.6 m/s; platform landings at the deck centre.
  - **Replay in the launch runtime:**
    - After the ascent, a `recovery` phase replays the booster from staging.
    - Controls: pause, warp up to 10×, and *Skip replay* (the assisted result is simulated instantly and marked as such).
    - *Fly the landing myself*: from below 9 km the player flies the landing burn. Shift/Ctrl or a slider set throttle (0–⅓ runs one engine, above that three); A/D tilt the thrust; it flies in real time.
    - Afterwards the debrief opens (suborbital) or the orbit hand-off is offered (orbital), carrying the booster result.
  - **Landing ratings (S–D)** (`rating.ts`): miss distance, sink rate, drift and tilt against the safe limits. They apply to booster catches, platform landings and ship landings.
    - The ship's debrief shows its rating and whether it was flown manually (the landing program unused below 5 km).
  - **Fleet and reuse** (`src/fleet/fleet.ts`):
    - Recovered boosters (B-n) and ships (S-n) join the fleet with flight count, wear and their last rating.
    - Wear grows with each flight, more after rough landings and heavy heating, and adds mission risk. A vehicle retires at 100% wear.
    - *Refurbish* resets wear at a one-off surcharge on the next flight; *Scrap* (with confirmation) removes a vehicle.
    - Vehicles match designs by a part-tree signature per stage, so editing only the ship keeps the booster reusable.
    - Reflights cost 12% of a new build plus a wear-dependent share; the *Rapid Reuse* tech lowers that further.
    - A reflown vehicle that is lost leaves the fleet.
  - **Per-mission budget:**
    - The program budget now caps each mission's hardware cost (new builds plus reflights) in the Mission Control poll, under a new "Recovery & budget" station.
    - Certification only warns when a new build exceeds the budget, so reflown hardware lets bigger designs fly.
  - **Mission Control Manifest:**
    - Booster recovery choice (Automatic, or an option disabled with its reason), booster and ship hardware (new build or matching fleet vehicles, with cost and wear).
    - Mission hardware cost against the budget, and the fleet list.
  - **Progression:**
    - New milestones: *Caught by the tower* (+2 RP), *Downrange landing*, *Ship recovered*, *Hands on the stick* (manual landing rated A or better, +1 RP and +25,000 cr), *Flight-proven* (recover reflown hardware).
    - New tech: *Rapid Reuse* and *Fleet Operations* (+75,000 cr budget).
  - **Visuals:**
    - The pad scene replays the booster: engines light from the centre out, grid fins unfold, legs deploy.
    - The tower arms wait open and close on capture, then lower the booster onto the mount.
    - A landing platform with its own patch of ocean appears downrange.
    - A new **Landing** camera (key 4) watches from the target.
    - Ship flaps trim with angle of attack and bank in the Flight scene, and its legs deploy for the final approach.
  - **Save format v5:** fleet, recovery and hardware on flight records, and recovery and fleet choices in the mission plan, with a v4→v5 migration and per-entry validation.
  - **Ship landing fix:** a light ship can't throttle below one engine at minimum thrust, so the landing program now pulses the engine instead of hovering until it runs dry.
- **Stage 7:**
  - **The station** (`src/station/stationOrbit.ts`): a fictional crewed outpost in a circular 400 km orbit in the same plane as the flight model.
    - Its position is set when the ship first reaches orbit, so the transfer window opens within about one orbit.
    - Helpers convert between the inertial frame and the station's local frame (LVLH: radial, along-track, cross-track).
  - **Assisted rendezvous** (`rendezvous.ts`), a new *Rendezvous with station* autopilot program:
    - Waits for the phase angle, then a Hohmann-style transfer burn up to the station's altitude.
    - Closes in with Clohessy–Wiltshire targeting to a hold point 2 km ahead, re-planned every minute.
    - Holds there; proximity operations become available inside 3.5 km and below 3 m/s relative.
    - The Flight HUD shows a *Station* panel (range, relative speed, time to the burn) and the station's position on the map and orbit inset.
  - **Proximity operations** (`proximity.ts`, `proximitySession.ts`), simulated in 3D in the station frame with the Clohessy–Wiltshire equations at fixed steps:
    - RCS translation (0.12 m/s², a 40 m/s budget) and rotation; attitude hold and port alignment.
    - An approach corridor (12° cone) and a 200 m keep-out sphere with a range-dependent closing-speed limit. Leaving the corridor or closing too fast inside it counts as a violation and warns.
    - **Docking outcome comes from the physics:**
      - Capture needs 0.02–0.35 m/s closing, ≤ 0.3 m offset, ≤ 4° angle, ≤ 5° roll and ≤ 0.1 m/s lateral speed.
      - Outside that window, contact at up to 0.8 m/s bounces off. Faster contact (or hitting the structure) is a collision that damages the hull.
      - Docks are graded S–D on how centred, slow and aligned the contact was.
    - **Docking assist** (G): flies to the corridor, aligns, and approaches at a safe closing speed. Any translation key takes over.
      - A dock counts as manual if the assist wasn't used in the last 30 m.
    - **Abort** (B) backs off to a safe point 340 m out and holds.
    - Time warp is limited to 10× in free flight near the station, and up to 1000× while docked.
  - **Docked tasks:** a hatch leak check (30 min) gates a science run (4 h), crew handover (3 h, with crew aboard) and a cargo transfer (2 h, with cargo).
    - *Undock* is enabled once all tasks are complete. Undocking pushes the ship gently out along the port axis.
    - *Depart* is enabled beyond 300 m and hands back to Flight / Orbit for the deorbit and landing.
  - **Mission rules** (`flightOutcome.ts`):
    - The *Station Crew Rotation* mission needs a docking adapter on the ship.
    - Its objectives are reach orbit, rendezvous, dock, tasks done, and land safely.
    - It's credited only with a completed docking and tasks, and the debrief shows a docking line (grade, manual, bounces, collisions, violations).
  - **Orbital Station location:**
    - A new 3D scene with the procedural station: modules, nodes, truss, solar wings, radiators, a docking target and blinking navigation lights.
    - The ship is shown in the station frame (floating origin), with Earth below.
    - Cameras: chase (1), docking camera with reticle (2), and a station view (3).
    - The HUD has an approach panel (range, closing speed, offsets, angles, corridor/keep-out state) and RCS pad controls for touch and mouse.
    - The location is unlocked by the orbital shakedown, and shows an explanatory empty state when no ship is nearby.
  - **Progression:** a new *First docking* milestone (+1 RP). The Moon stays locked.
  - **Save:** flight records carry the docking summary, parsed with validation. The format stays v5; older records simply have none.

## Assumptions (documented, reversible)
- Flight physics is a simplified planar gameplay model: one orbital plane (the equator), no Earth rotation, an exponential atmosphere, lumped aerodynamics, and Sutton–Graves heating with gameplay heat capacities. The UI and footnotes say so; it is not a flight simulator.
- Out-of-plane steering isn't simulated. Yaw is visual only, and bank only reduces in-plane lift (enough to steer re-entry range).
- Geography is simplified: the launch coast is the only land on the ground track. Landing on the coast off-pad still recovers the ship; any gentle or hard contact on water is a crew-safe splashdown, but the ship is lost.
- Assisted flight is on by default (the ship starts with Circularize engaged if the orbit isn't yet stable). Any manual input hands over without a jump.
- A crew left in space via *End flight* is assumed rescued (the result is "flight ended", not credited). Breakup or a crash is fatal for the crew.
- The orbital flight isn't saved mid-flight. Reloading during a flight loses it, but the mission commitment is only used up when the flight is recorded, so you can launch again.
- A flight advances only while its location is active (the pad for the ascent, Flight / Orbit for the orbit), as in Stage 4.
- Mission readiness Δv remains a conservative estimate, now including the booster's recovery reserve.
  - The reference design flies the Crewed Orbital Shakedown with a tower catch and lands its ship with about 11 t of propellant to spare.
  - Heavy payloads with a catch can come up short; Mission Control flags this and suggests the platform. The Shakedown's Δv requirement rose to 9,750 m/s to match.
- Booster recovery is a 2D gameplay model in the ascent's frame. Guidance laws are simplified versions of real techniques (powered-descent guidance, suicide burns), tuned for the game.
- The recovery is a replay from staging that runs after the ascent, not a parallel simulation. Skipping it simulates the assisted result.
- The platform repositions per flight to the booster's natural landing point; the ship's ocean platform zone ("Kestrel") is a separate, fixed zone.
- Wear, reflight pricing and rating thresholds are game values.
- The station shares the ship's orbital plane (no plane-change problem). Proximity motion uses the linearised Clohessy–Wiltshire equations, accurate near the station, and docking limits, RCS budget and task durations are game values.
- Rendezvous uses the main engines from orbit until the hold point; RCS takes over only for proximity operations, and RCS propellant is a separate budget, not drawn from main tanks.
- Proximity operations aren't saved mid-flight, like the rest of the orbital flight.

## Checks (last run)
- `npm run typecheck`, `npm run lint`, `npm run build`: pass.
- `npm test`: 190 tests pass across 18 files. New in Stage 7 (`tests/station.test.ts`):
  - station-frame conversion round trip; Clohessy–Wiltshire motion matching two-body motion near the station; the CW targeting solution;
  - the assisted dock from the hold point inside the capture window; bounce when misaligned; collision when too fast;
  - corridor and keep-out violations; docked-task gating and undocking;
  - a full end-to-end station mission in the flight runtime (orbit → rendezvous → dock → tasks → undock → depart → deorbit → landing, credited);
  - station objectives and credit only with a completed docking.
- Stage 6 tests (`tests/recovery.test.ts`, plus save and launch updates):
  - recovery hardware rules and defaults; the staging reserve; per-stage design signatures;
  - assisted tower catch inside the capture window; platform landing at the stationed deck;
  - loss without landing propellant; manual takeover; manual credit only for a fully manual burn;
  - S–D ratings;
  - fleet pricing (wear, refurbishment, Rapid Reuse), naming, wear, retirement, loss and compatibility;
  - Mission Control recovery Δv, hardware, per-mission budget, reflown hardware, wear risk, missing or mismatched vehicles;
  - launch runtime replay → debrief (suborbital) and → hand-off with the result (orbital); expend skips the replay;
  - store recording: fleet, milestones, released assignments;
  - v4→v5 save migration and fleet/recovery parsing.
- Headless Chromium smoke test, Stage 7 (manual script, not committed), with no console errors:
  - The Orbital Station location shows its empty state before a mission; the station mission is committed with the reference design, platform recovery and 2 crew.
  - Launch → orbit (318 × 268 km) → *Rendezvous with station*: waited for the window, burned, coasted up and closed on the hold point; *Begin proximity operations* switched to the Orbital Station location.
  - Docking camera and reticle; W thrusts forward; the assist (G) flew the corridor and docked at 0.06 m/s, 0.13 m off, rated A, with 0 violations, bounces or collisions and about 20 m/s of RCS left.
  - Warped through the docked tasks, undocked, aborted (B) to a safe distance, departed, and the objectives showed rendezvous, dock and tasks done.
  - Deorbit to the launch site: landed on the pad (rated B). The debrief showed mission success, the docking line, the booster platform result and the credit.
  - Fixes from this run: 100× warp while coasting up to the station, the chase camera keeping the ship framed at long range, a compact approach panel, docked-state panel values, visible unlock hints, and readable key badges on active buttons (re-checked in the browser).
- Headless Chromium smoke test, Stage 6, with no console errors:
  - **Flight 1** (test flight, tower catch, assisted):
    - Replay: separation → flip → boostback → coast → glide → landing burn.
    - Caught 0.0 m off centre at 1.6 m/s, rated S. The arms close on the booster and lower it onto the mount.
    - B-1 joins the fleet; *Caught by the tower* is awarded.
  - **Flight 2** (reflown B-1 to the ocean platform):
    - The manifest shows the reflight at 77,217 cr vs 136,700 cr new.
    - The Landing camera watches from the deck; the manual-landing toggle works. Landed at deck centre, and B-1's wear rose.
    - This run exposed a manual-credit exploit, now fixed and covered by a test.
  - **Flight 3** (Crewed Orbital Shakedown, tower catch, replay skipped):
    - The thin-Δv warning shows.
    - The hand-off dialog carries the simulated catch result. *End flight* in orbit gives a debrief with the booster line, and B-2 joins the fleet.

## Known limitations
- Headless software rendering is slow, so timings in the smoke test differ from real browsers.
- Manual landings take practice: there is no landing-burn predictor beyond the HUD's height, speeds and target distance.
- Asymmetric flap deflection for bank isn't modelled visually (all flaps deflect together).
- The replay doesn't show the ship and booster at the same time.
- The assisted tower-catch landing burn lights high (around 12–15 km) and runs long. It reliably catches, but it's less efficient than a real booster's short final burn (tuning candidate).
- The Earth texture is procedural and low-resolution (1024×512); near the ground a flat local surface tile stands in for terrain.
- Ctrl is the throttle-down key; browsers reserve some Ctrl combinations (e.g. Ctrl+W), so use the X cutoff or the buttons if in doubt.
- There's no free-fly camera, and the map view shows the predicted path but no manoeuvre planning nodes.
- The rendezvous is assisted only: there are no manual phasing burns or a planning tool for them.
- The station has a single (forward) docking port and doesn't rotate; the ship's model isn't animated for RCS puffs.
- Crew transfer and cargo tasks are timed progress bars, not interactive activities.

## Next action
Review Stage 7. When approved, begin **Stage 8: Moon missions**: an Earth–Moon transfer as a time-compressed phase, lunar orbit, landing site selection and descent, surface objectives and the return to Earth.
