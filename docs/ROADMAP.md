# Development Roadmap

## Guiding rule

Each stage must result in a runnable, testable app. Do not begin the next stage until the current stage is reviewed. Build breadth only after the core loop feels good.

## Stage 0 — Project foundation
**Goal:** a clean TypeScript + Vite + Three.js project foundation.

Deliver:
- App starts locally and builds.
- Full-window responsive canvas with basic renderer setup.
- Basic UI shell and persistent location selector (locations can initially be disabled except Factory).
- Typed game state and scene lifecycle abstraction.
- Loading/error/unsupported-WebGL states.
- README run instructions, lint/typecheck/test scripts.
- `docs/STATUS.md` initialized.

Acceptance:
- `npm install`, `npm run dev`, and `npm run build` work.
- Renderer resizes correctly and cleans up event listeners.
- No major browser console errors.

## Stage 1 — Rocket Factory / Assembly Hall (FIRST PLAYABLE MILESTONE)
**Goal:** the player enters a detailed-feeling factory and assembles a recognizable rocket from individual parts.

Deliver:
- Procedural 3D assembly hall: floor, walls, trusses, work lights, gantry, crane rails, platforms, tool stations, and large doors.
- Orbitable camera with sensible limits and a “reset camera” control.
- Modular rocket parts catalog, including:
  - Upper-stage / crew ship hull sections
  - Nose cone
  - Crew cabin and windows
  - Cargo/payload bay module
  - Fuel tank segments
  - Booster tank sections
  - Engine mounts and multiple engine bells
  - Grid fins / steering surfaces
  - Aerodynamic flaps
  - Landing legs
  - Docking adapter
  - Interstage/connection ring
  - Heat-shield tiles or heat-shield material section
  - Plumbing, access hatches, RCS thruster blocks, antennae and small detail modules
- Parts represented as separate meshes or groups with IDs, names, mass, cost, category, compatible attachment points, and unlocked/locked status.
- Assembly interface: browse/select a part, place it on a compatible attachment point, rotate where allowed, remove/replace, inspect stats.
- Visual attachment point indicators and valid/invalid placement feedback.
- Starter blueprint with a guided build sequence.
- Live stats: dry mass, propellant capacity, engine thrust, crew capacity, estimated cost, and build completeness.
- Save/load current build using localStorage with schema versioning.
- Tutorial / checklist for first build.
- Camera focus on selected part and readable part details.

Acceptance:
- Rocket is visibly assembled from components, not a single monolithic model.
- Parts snap to compatible sockets; invalid connections are rejected with helpful feedback.
- User can remove and reattach parts without corrupting state.
- Refreshing the page preserves the saved build.
- UI navigation to other locations is visible but clearly marked “Unlocks in a later stage” until implemented.

## Stage 2 — Factory polish and vehicle validation
**Goal:** make assembly feel intentional and ensure builds can be evaluated.

Deliver:
- Better part variants and material finish options.
- Build validation: missing engines, no nose/ship top, unsupported mass, incompatible stages, no landing system, insufficient propellant, no crew module for crew missions.
- Vehicle readiness report with clear fixes.
- Blueprint save/load, duplicate configuration, reset to starter design.
- Basic manufacturing progression: credits, part unlocks, research milestones, optional fabrication timers that can be skipped or accelerated through normal play (avoid grind).
- Accessible list-based assembly mode in addition to 3D picking.

Acceptance:
- Invalid rocket cannot proceed to a mission without a clear override/tutorial mode.
- Player understands why the vehicle passes or fails checks.
- Blueprint data is versioned and robust to malformed saves.

## Stage 3 — Mission Control
**Goal:** choose a mission and prepare a launch.

Deliver:
- Mission Control room 3D scene with consoles, wall displays, mission map, and launch status.
- Mission selector: uncrewed test flight, orbital flight, station rendezvous/docking, lunar transfer, later lunar landing/return.
- Crew roster with names, roles, skill levels, and safety status; fictional characters only.
- Payload and crew manifest.
- Mission readiness checks: rocket build, propellant, crew capacity, life support, guidance, communication, destination-specific equipment.
- Launch window and weather/conditions as game modifiers, not real forecast data.
- Mission briefing, objectives, and abort criteria.
- Save selected mission and crew manifest.

Acceptance:
- Launch is blocked if critical requirements fail, with actionable explanations.
- User can return to factory without losing mission setup.
- A valid mission can be taken to the launch pad.

## Stage 4 — Launch Pad and countdown
**Goal:** transport the built vehicle to a launch site and conduct a launch sequence.

Deliver:
- Exterior launch site scene with launch mount, tower/arms, tank farm, service roads, flame trench, perimeter, distant landscape and sky.
- Rocket appears using the player's current blueprint.
- Transport/erection sequence may be stylized but must be visible and skippable.
- Countdown checklist, fuel loading, crew boarding, tower clearance, engine chill/ignition sequence.
- Camera modes: cinematic, vehicle follow, pad overview.
- Launch countdown with pause/abort.
- Basic ascent simulation with thrust, mass reduction from fuel, gravity, atmospheric drag approximation, pitch program, staging/separation, and telemetry.
- Launch abort and post-flight debrief.

Acceptance:
- Launch is impossible until all mandatory checks pass or tutorial override is selected.
- A launch can complete from pad to a stable gameplay-defined orbit or fail in a readable way.
- Simulation update is fixed/capped timestep and can be paused.

## Stage 5 — Flight HUD and Earth orbit
**Goal:** give the player an interactive, understandable first spaceflight.

Deliver:
- Earth globe with clouds/atmosphere layers and procedural or licensed textures.
- Vehicle attitude controls: pitch, yaw, roll, throttle, engine cutoff, staging, camera mode.
- HUD: altitude, velocity, throttle, fuel, stage, orbital status, crew status, mission objective.
- Map/orbit view and simplified orbital state.
- Orbital insertion and deorbit/return options.
- Re-entry heating and landing zone selection in simplified form.
- Mission debrief with results, earned credits/research, vehicle condition and unlocks.

Acceptance:
- At least one complete playable loop: build → mission setup → launch → orbit → return/debrief.
- Flight controls respond predictably and provide help/tooltips.
- Clear distinction between simulated altitude and true orbital state.

## Stage 6 — Reusable booster and ship landing
**Goal:** add a game-like but satisfying recovery challenge.

Deliver:
- Booster separation and return burn.
- Booster guidance, boostback/burn timing as simplified game mechanics.
- Landing target selection and landing camera.
- Grid-fin/flap/leg deployment animations.
- Vertical landing controls or assisted landing mode.
- Ship re-entry and landing sequence.
- Recovery score based on landing accuracy, remaining fuel, vehicle damage and crew safety.
- Recovered components can be refurbished and reused.

Acceptance:
- Landing can succeed or fail based on player inputs and telemetry.
- The game communicates simplified physics and forgiving assist options.
- Recovery updates the vehicle's condition and player progression.

## Stage 7 — Orbital station rendezvous and docking
**Goal:** fly a crew mission to an ISS-like station.

Deliver:
- Fictional orbital station with modules, solar arrays, docking ports and lighting.
- Rendezvous phase with relative range, closing speed, approach corridor and target alignment.
- RCS thruster controls and docking assist.
- Collision/keep-out warning and abort-to-safe-distance behavior.
- Docking success, crew transfer/cargo tasks, undocking and return.
- Avoid use of real station assets unless license/attribution is handled.

Acceptance:
- A player can approach, align, dock, complete a task and return.
- Docking is more than a cinematic trigger: range, speed and alignment affect outcome.

## Stage 8 — Moon missions
**Goal:** extend mission planning and travel to the Moon.

Deliver:
- Earth-to-Moon transfer as a time-compressed gameplay phase.
- Lunar orbit and lunar surface.
- Lunar landing site selection, terrain hazards and descent controls.
- Crew/cargo objectives, surface EVA as a later optional feature.
- Return-to-Earth route, propellant constraints and mission debrief.

Acceptance:
- Moon missions require appropriate vehicle configuration and resources.
- The player can complete at least one end-to-end lunar mission in simplified form.

## Stage 9 — Expansion and polish
Possible extensions:
- Mars transfer and other deep-space destinations
- In-space refueling and orbital construction
- More vehicle parts, custom liveries and blueprints
- Research tree and contracts
- Photo mode and replay
- Accessibility options, controller support, localization
- More realistic orbital mechanics as an optional advanced mode
- Performance optimization, visual polish, save migration and broader automated tests

Do not build Stage 9 features until the core build → launch → flight loop is stable.
