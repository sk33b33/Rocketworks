# Project Status

## Current stage
**Stage 1: Rocket Factory / Assembly Hall.** Complete and waiting for review.

## Completed
- **Stage 0:** foundation. Vite, React, Zustand, Three.js and strict TypeScript; a single renderer; the scene lifecycle; the location selector; loading, error and unsupported-WebGL screens.
- **Stage 1:** the first playable milestone.
  - **Domain** (`src/rocket/`, no Three.js or React):
    - Typed part definitions and placed part instances; each instance records its parent instance and socket.
    - A 23-part catalog: booster engine/tank/forward sections, hot-stage interstage, ship aft/tank/extended tank, crew cabin with windows, cargo bay, nose cone, sea-level and vacuum engines, grid fins, forward/aft flaps, landing legs, heat-shield tiles, docking adapter, RCS block, antenna, access hatch, chine conduit and solar array. Three parts are locked teasers.
    - Typed socket kinds keep ship parts off the booster stack, engines on engine mounts, and so on.
    - Pure operations: attach, remove (takes the whole subtree), replace (keeps children whose sockets still fit), rotate (per-part step), and fill all compatible slots.
    - `canAttach` returns a player-readable reason for every rejection.
    - `validateBlueprint`: structural integrity checks for loaded saves.
    - `calculateRocketStats`: dry mass, propellant, wet mass, booster and ship thrust, crew, cost, and a simplified liftoff TWR.
    - Guided starter build (`starterGuide.ts`): 14 required and 2 optional steps, evaluated from the blueprint, with "Do it for me" auto-completion. Build completeness is the share of required steps done.
  - **Persistence** (`src/persistence/`):
    - Autosave to localStorage after every change, with a save version number and a migration hook.
    - Saves are validated at runtime on load.
    - A corrupt save is backed up to `rocketworks.save.corrupt` and the player is told. Without storage the game runs in memory and shows a warning.
  - **Rendering** (`src/render/`):
    - `BlueprintRenderer` turns any blueprint into a Three.js hierarchy, with each part's group nested under its parent's socket. The same adapter is meant for the pad and flight scenes later.
    - Every part has a procedural model. Geometry, materials and textures are shared through `ResourceCache`, so rebuilding the rocket never grows GPU memory (unit tested).
  - **Factory scene** (`src/scenes/factory/`):
    - A procedural high-bay hall: concrete floor, walls, columns, girts, roof trusses, a moving bridge crane, a service tower with platforms, work lights with haze shafts, tool stations, half-open hangar doors, hazard markings, dust particles, a reflection environment and selective shadows.
    - An assembly stand with hold-down clamps.
    - Orbit camera with limits, reset and focus. With the canvas focused, arrow keys orbit, +/- zooms and Shift+arrows pans.
    - Clicking parts selects them. Clicking a marker attaches the selected part; drags are ignored as clicks.
    - Attachment markers: large pulsing green rings for valid points, small red dots for invalid ones. Hovering a valid point shows a translucent preview of the part snapped in place.
    - Selection and hover outlines.
  - **Factory UI** (`src/ui/factory/`):
    - Guide checklist.
    - Searchable catalog showing free slots and a "Next" badge.
    - Inspector for catalog parts and installed parts: facts, "Fill all", a keyboard-accessible list of attachment points, focus, rotate, remove with confirmation for subtrees, and replace (locked alternatives explain why).
    - Live stats with a completeness bar and TWR status shown with ✓ / ! / ✕, not only colour.
    - Reset build and load reference design, both with confirmation.
    - Camera toolbar with a controls help panel.
    - Shortcuts: Esc, Del, R, F, C, ?.
    - On narrow screens the panels collapse into a tabbed bottom sheet.
  - Other locations stay visible and locked, with reasons.

## Assumptions (documented, reversible)
- **Game scale:** about 70% of a real heavy-lift vehicle's height, with a 9 m diameter. The full stack is about 90 m including the 6 m stand.
- Masses, propellant capacities and thrust are game-tuned for readable results. The reference design's liftoff TWR is about 1.6. The UI labels these as simplified values.
- Ship sections have fixed orientation so the heat shield stays windward (+Z). Booster tanks rotate in 45° steps; detail modules in 90° steps.
- Stack sections build bottom-up. There is no "insert into the middle of a stack"; remove and re-add instead. The guide explains this when blocked.

## Checks (last run)
- `npm run typecheck`, `npm run lint`: pass.
- `npm test`: 51 tests pass across 9 files:
  - catalog integrity
  - compatibility and rejection reasons
  - attach, remove, replace, rotate and fill
  - validation
  - stats
  - guide and auto-complete
  - save/load: malformed, future-version and throwing storage
  - store flows
  - renderer mapping and cache stability
- `npm run build`: pass. The bundle is about 908 kB minified (246 kB gzip), mostly Three.js.
- Headless Chromium smoke tests (manual scripts, not committed), production and dev (StrictMode double mount) builds, all with no console errors or warnings:
  - catalog selection shows markers;
  - "Fill all" attaches 13 engines and reports step completion;
  - an unplaceable part explains why;
  - guide auto-steps work;
  - the reference design loads (50 parts, 100%);
  - clicking the rocket selects a part, and focus works;
  - a reload preserves the build;
  - a corrupt save shows a notice and keeps a backup;
  - the mobile tabbed layout works.

## Known limitations
- No undo. Removing a part with attachments asks for confirmation first.
- The camera can't fly fully around the hall. Its target is clamped near the stand and it stays inside the walls.
- Picking uses raycasts against all part meshes. This is fine for about 50 parts; a BVH may be needed for much larger builds.
- Reloading is the only way to recover from a lost graphics context.
- No Playwright suite is committed yet (deferred by agreement).
- Rocket colours and finishes are fixed. Material and finish options are Stage 2.

## Next action
Review Stage 1. When it is approved, begin **Stage 2: Factory polish and vehicle validation**: readiness rules, part variants, progression and a list-based assembly mode.
