# Project Status

## Current stage
**Stage 6: Reusable booster and ship landing.** Complete and waiting for review.

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

## Checks (last run)
- `npm run typecheck`, `npm run lint`, `npm run build`: pass.
- `npm test`: 181 tests pass across 17 files. New this stage (`tests/recovery.test.ts`, plus save and launch updates):
  - recovery hardware rules and defaults; the staging reserve; per-stage design signatures;
  - assisted tower catch inside the capture window; platform landing at the stationed deck;
  - loss without landing propellant; manual takeover; manual credit only for a fully manual burn;
  - S–D ratings;
  - fleet pricing (wear, refurbishment, Rapid Reuse), naming, wear, retirement, loss and compatibility;
  - Mission Control recovery Δv, hardware, per-mission budget, reflown hardware, wear risk, missing or mismatched vehicles;
  - launch runtime replay → debrief (suborbital) and → hand-off with the result (orbital); expend skips the replay;
  - store recording: fleet, milestones, released assignments;
  - v4→v5 save migration and fleet/recovery parsing.
- Headless Chromium smoke test (manual script, not committed), with no console errors:
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

## Next action
Review Stage 6. When approved, begin **Stage 7: ISS-like orbital station**: a fictional station in orbit, rendezvous planning, approach and docking, and the Orbital Station location.
