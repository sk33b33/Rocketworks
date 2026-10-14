# Rocketworks — Claude Code Game Development Package

A staged project scaffold and instruction package for building a browser-based 3D rocket construction and spaceflight game with Three.js/WebGL.

## Running the game

Requires Node.js 20+ and a browser with WebGL 2.

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript strict check
npm run lint       # ESLint
npm run format     # Prettier
```

Current progress is tracked in `docs/STATUS.md`.

**Playing the factory (Stage 1):**
- Follow the *Guided build* panel, or pick any part in the *Parts catalog* and click a green marker on the rocket.
- Click a placed part to inspect, rotate, replace or remove it.
- Drag to orbit, right-drag to pan, scroll to zoom. Press `?` for all controls.
- Your build autosaves in the browser.

**Validating and managing designs (Stage 2):**
- The *Readiness* tab lists what stops the design from flying, with a fix button for each issue. *Certify for flight* when it's ready, or use the tutorial override.
- The *Program* tab shows your budget, research points, research projects and milestones.
- The *Designs* tab keeps several named designs: duplicate, rename, delete, choose a hull finish.
- *Structure list* (left panel) builds the rocket from a list instead of the 3D view.
- Ctrl+Z / Ctrl+Shift+Z undo and redo.

**Planning a mission (Stage 3):**
- Certify a design, then open *Mission Control* from the location bar.
- Pick a mission, then assign the vehicle, payload and crew in *Manifest*.
- *Readiness* shows the flight director's GO/NO-GO poll, with a fix button for each issue.
- *Conditions* shows the launch window and weather. *Wait for next window* is free.
- *Commit mission · GO for rollout* when every station is GO, then *Go to Launch Pad*.

**Launching (Stage 4):**
- The committed vehicle rolls out to the pad. *Skip rollout* if you're in a hurry.
- *Start countdown*. Space holds or resumes; *Skip to T-10 s*; *Scrub* costs nothing.
- After liftoff: Space pauses, `[` `]` or the buttons set time warp, 1/2/3 switch cameras (Pad, Follow, Cinematic), and *ABORT* asks you to confirm.
- The debrief shows the result and rewards. The ascent is a simplified 2D model.

**Flying to orbit and back (Stage 5):**
- Orbital missions don't end at orbit insertion: the pad offers *Continue to Flight / Orbit*.
- The autopilot can fly everything. *Circularize* if needed, coast one full orbit (time warp up to 1000× above 110 km), pick a landing zone, then *Deorbit to target*. Re-entry guidance and the landing burn follow automatically.
- Take over at any time: W/S pitch, Q/E bank, Shift/Ctrl throttle, Z full throttle, X cutoff, Space pause, `.` `,` warp, 1/2/M cameras (chase, orbit, map), `?` help.
- The debrief shows the landing outcome, miss distance, heat-shield and hull condition, peak g and rewards. The flight model is simplified (planar, no Earth rotation).

**Recovering and reflying hardware (Stage 6):**
- In Mission Control's Manifest, choose the booster recovery: tower catch, ocean platform or expend. Recovery holds back booster propellant, which costs ascent performance. Assign recovered boosters and ships from the fleet to fly them again for a fraction of the cost.
- After the ascent, the booster's return replays from staging. Watch it with the **Landing** camera (4), *Skip replay* to simulate it, or choose *Fly the landing myself* below 9 km (Shift/Ctrl throttle, A/D tilt) for a precision rating and a bonus milestone.
- Landings are rated S–D. Recovered vehicles wear with use: refurbish them in the Manifest's fleet list, or scrap them.

**Visiting the orbital station (Stage 7):**
- Fly the Crewed Orbital Shakedown first. That unlocks *Station Crew Rotation* and the **Orbital Station** location. The ship needs a docking adapter (Factory).
- In orbit, engage *Rendezvous with station*. The autopilot waits for the transfer window, burns, and closes to a hold point 2 km ahead of the station (warp is safe).
- *Begin proximity operations* switches to the Orbital Station location. Fly with RCS: W/S forward/back, A/D left/right, R/F up/down, arrows pitch/yaw, Q/E roll, T attitude hold, Y align to the port. Or use the on-screen pad.
- G toggles the docking assist and B aborts to a safe distance. Cameras: 1 chase, 2 docking camera with reticle, 3 station view.
- Stay inside the approach corridor and below the closing-speed limit. Contact that is too fast or misaligned bounces off or damages the hull.
- Once docked, warp through the tasks (leak check, science, crew handover, cargo), *Undock*, back off beyond 300 m, *Depart*, and deorbit as usual. The relative-motion model is simplified (Clohessy–Wiltshire, single orbital plane).

## Core concept

The player starts at a spaceflight development complex and progresses through:
1. **Rocket Factory / Assembly Hall** — fabricate, inspect, and assemble a reusable heavy-lift rocket inspired by modern stainless-steel launch vehicles.
2. **Mission Control** — configure payload, crew, mission, launch window, and flight systems.
3. **Launch Pad** — transport the rocket, run countdown checks, launch, fly, and attempt a landing.
4. **Spaceflight** — reach orbit, rendezvous/dock with an ISS-like station, orbit Earth, travel to the Moon, and later unlock deeper-space destinations.

The first playable milestone is deliberately narrow: a polished assembly-hall scene with a modular rocket that can be assembled from parts. Do not start by attempting the entire simulation.

## Recommended stack

- TypeScript
- Vite
- Three.js (WebGLRenderer; use WebGL2-compatible features and graceful fallback messaging)
- React only if it helps the UI; keep the 3D scene architecture independent from UI framework
- Zustand or a small typed state store for shared game state
- Vitest for unit tests
- ESLint + Prettier
- Playwright for smoke tests once the app runs

Claude should verify current package versions and APIs before installing or using them. Do not assume a model name or capability from this package; use whichever Claude model the user has selected in Claude Code.

## Start here

1. Copy the contents of this package into the root of a new repository.
2. Open the project root in Claude Code.
3. Ask Claude to read `CLAUDE.md`, then `docs/ROADMAP.md` and `docs/DEFINITION_OF_DONE.md`.
4. Tell Claude: **“Begin Stage 0 only. Inspect the repository, propose a short implementation plan, then implement only the Stage 0 foundation. Do not jump ahead.”**
5. Review and run each stage before asking Claude to proceed.

## Important implementation rules

- Build in small, runnable stages. Keep the project working after every stage.
- Prefer a believable, readable simulation over pretending to be a full aerospace engineering simulator.
- Use fictionalized destinations and clearly label simplified physics.
- The rocket should be modular and assembled from actual 3D parts, not a single pre-made mesh.
- The first milestone is the factory/assembly hall and part-by-part rocket assembly.
- Use real 3D navigation among Factory, Mission Control, and Launch Pad; do not make these merely dead-end menu screens.
- Keep UI usable on desktop first, but make it responsive and touch-friendly.
- Do not claim orbital mechanics, fuel usage, or landing are physically exact. Make assumptions visible in docs and UI.
