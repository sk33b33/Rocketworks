# Architecture Guidelines

## Suggested directory layout

```text
src/
  app/
    App.tsx
    gameStore.ts
    locationRegistry.ts
  game/
    GameRuntime.ts
    SceneManager.ts
    RenderLoop.ts
    input/
    camera/
  scenes/
    factory/
      FactoryScene.ts
      AssemblyHall.ts
      assemblyLayout.ts
    mission-control/
    launch-pad/
    flight/
    orbit/
    station/
    moon/
  rocket/
    catalog/
      parts.ts
      blueprints.ts
    model/
      RocketPart.ts
      RocketBlueprint.ts
      AttachmentPoint.ts
    assembly/
      AssemblySystem.ts
      compatibility.ts
      validation.ts
    stats/
      calculateRocketStats.ts
  simulation/
    clock.ts
    units.ts
    ascent/
    orbit/
    docking/
    landing/
  missions/
    missionCatalog.ts
    missionReadiness.ts
  progression/
  persistence/
    saveGame.ts
    migrations.ts
  ui/
    layout/
    navigation/
    factory/
    mission-control/
    flight/
    shared/
  assets/
  styles/
tests/
docs/
```

This is a suggested structure, not a mandate. Adapt it to the existing repository and avoid creating empty folders without a use.

## Layer boundaries

- **Domain:** plain TypeScript data and pure functions. No Three.js imports.
- **Simulation:** deterministic step/update logic; avoid direct DOM/UI dependencies.
- **Rendering:** Three.js scenes, meshes, lights, cameras, picking, and effects.
- **UI:** navigation, forms, telemetry displays, checklists, tooltips.
- **Persistence:** schema-versioned save data and migrations.
- **App orchestration:** connects domain, simulation, rendering, and UI.

## Core domain concepts

### RocketPartDefinition
Fields should include:
- `id`, `name`, `description`
- `category`
- `dryMassKg`, `costCredits`
- optional `propellantCapacityKg`, `thrustN`, `crewCapacity`
- attachment points / socket definitions
- allowed orientations or rotation increments
- unlock requirements
- visual recipe / renderer factory key
- tags and mission capability flags

### RocketPartInstance
- unique instance ID
- part definition ID
- parent instance ID or root marker
- attachment point IDs used for connection
- local position and rotation only if the design permits free placement
- condition / wear when recovery is implemented

### RocketBlueprint
- schema version
- blueprint ID and name
- ordered part instances and attachment links
- created/updated timestamps
- optional livery/paint choices

### GameState
- current location
- active stage/unlocks
- credits/research
- current blueprint
- active mission and manifest
- vehicle state
- save version

## Scene lifecycle

Use a scene registry and a lifecycle contract such as:
- `create(context)`
- `enter(previousLocation)`
- `update(deltaSeconds)`
- `exit(nextLocation)`
- `dispose()`

A location transition must preserve domain state and dispose of scene-only resources. Avoid creating a new renderer each time a location changes.

## Rocket rendering

The same blueprint should drive:
1. The factory assembly display.
2. Vehicle readiness statistics.
3. The rocket shown at the launch pad.
4. The vehicle shown in flight.

Do not maintain four unrelated copies of the rocket model. Create a renderer/scene adapter that translates blueprint instances into Three.js groups and meshes.

Use procedural geometry first. Make a visual recipe per part definition, then build the complete vehicle by applying attachment transforms.

## Simulation principles

- Store units explicitly in names or types (`altitudeM`, `velocityMS`, `fuelKg`).
- Use SI units internally.
- Convert units for UI display only.
- Use a fixed/capped timestep for dynamic systems.
- Separate simplified gameplay parameters from physical constants.
- Keep core calculations pure and unit-tested.
- Document assumptions: atmosphere, gravity, engine performance, orbital thresholds, transfer timing, drag and landing assists.
- Provide assists and difficulty presets instead of pretending the game is a certified engineering simulator.

## Persistence

- Use versioned JSON saves in localStorage for early stages.
- Validate parsed data at runtime.
- Never trust stored data to be well-formed.
- Include migrations and a reset-save option.
- Keep save serialization independent from Three.js objects.

## Performance

- Reuse geometries/materials where possible.
- Use instancing for repeated small details.
- Avoid excessive real-time shadows; use them selectively.
- Dispose scene-specific GPU resources on exit.
- Use level-of-detail or hide distant details where needed.
- Target smooth performance on mainstream desktop browsers before adding heavy post-processing.
