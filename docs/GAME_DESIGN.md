# Game Design Brief

## Working title
Rocketworks

## Player fantasy
Build a capable reusable rocket from raw components, see it in a believable industrial facility, prepare a crewed mission, launch from Earth, and expand from low orbit to station visits and lunar exploration.

## Core loop
1. **Design/build:** choose parts, attach modules, inspect stats and solve compatibility issues.
2. **Prepare:** select destination, crew, payload, and mission objectives.
3. **Operate:** complete checklists, fuel and launch the rocket.
4. **Fly:** control the vehicle with assists available; manage fuel and flight objectives.
5. **Recover:** land the booster/ship when applicable, inspect damage, earn rewards.
6. **Progress:** unlock parts, missions, facilities, and destinations.

## First playable slice
The first playable slice is only the factory:
- Walk into / navigate around the assembly hall using camera controls.
- View a modular rocket on a build stand.
- Select a component from a catalog.
- Attach compatible parts to highlighted sockets.
- Remove or replace parts.
- Watch rocket statistics update.
- Save and reload the blueprint.
- Navigate between the Factory, Mission Control, and Launch Pad locations, with future locations locked.

## Locations/navigation
Persistent location switcher:
- **Rocket Factory** — available first; assembly and fabrication.
- **Mission Control** — available after Stage 3.
- **Launch Pad** — available after Stage 4.
- **Flight / Orbit** — available after Stage 5.
- **Orbital Station** — available after Stage 7.
- **Moon** — available after Stage 8.

A location can be shown as locked in the navigation, but it must not pretend to be playable before it is implemented. Locked locations should display their unlock condition.

## Rocket silhouette and component families
Aim for a recognizable reusable two-stage launch vehicle:
- Reusable first-stage booster with tank body, engine cluster, grid/steering fins, landing legs, interstage/connection interface.
- Upper-stage crew ship with nose cone, crew compartment, windows, propellant tanks, engine cluster, heat shield, flaps, landing hardware and docking adapter.
- Optional cargo version with payload bay and no crew windows.
- Use modular cylinder/cone/ring meshes and procedural details; no proprietary logos.

## Mission ladder
1. Factory acceptance / static systems test.
2. Uncrewed hop or short test flight.
3. Low Earth orbit.
4. Orbital station rendezvous and docking.
5. Cargo delivery / crew rotation.
6. Lunar transfer and orbit.
7. Lunar landing and return.
8. Optional deep-space destinations.

## Accessibility and difficulty
- Assisted controls are the default.
- Advanced/manual mode can be added later.
- Pausing, camera modes, tooltips and readable telemetry are important.
- Never make a player memorize unexplained key combinations.
- Include reduced camera shake and simplified landing options where possible.
