# Project Instructions — Rocketworks

## Role

Act as a senior game engineer, Three.js technical artist, simulation designer, UX designer, and pragmatic technical lead. Build a browser-based 3D game in TypeScript using Three.js/WebGL. Work incrementally and keep the app runnable.

## Product vision

The player develops a reusable crew-capable heavy-lift rocket inspired by the general form of Starship-style launch systems, without copying logos or requiring exact engineering accuracy. They start in a factory, build a rocket from individual components, prepare a mission in Mission Control, travel to the launch pad, launch from Earth, and progressively unlock:
- Low Earth orbit
- An ISS-like orbital station for rendezvous and docking
- Earth orbit / free flight
- Moon transfer and lunar orbit
- Lunar landing / return (later stage)
- More distant destinations (future expansion)

The game is about the satisfying progression from manufacturing to launch operations to exploration. Treat aerospace details as approachable game systems, not a certified flight simulator.

## Non-negotiable staged workflow

1. Read `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, and `docs/DEFINITION_OF_DONE.md`.
2. Work on **one stage at a time**.
3. Before coding a stage, provide: scope, files likely to change, risks, and a short test plan.
4. Implement only that stage unless the user explicitly approves more.
5. Run available checks, fix regressions, and summarize what works, what is missing, and how to test it.
6. Never silently replace working systems with placeholders. Clearly label temporary visuals and TODOs.
7. If a decision is reversible, choose a sensible default and document it instead of repeatedly blocking for clarification.
8. If a required detail is unknown, investigate the repository and current official documentation before inventing an API.
9. Keep a `docs/STATUS.md` file current at the end of every stage.

## Stage order

Follow `docs/ROADMAP.md` exactly. The first visible playable deliverable is **Stage 1: Factory / Assembly Hall** with a modular rocket assembled from individual 3D parts. Do not start with launch simulation, orbital flight, or a giant feature-complete architecture.

## Technical constraints

- TypeScript strict mode.
- Three.js for 3D rendering; use `WebGLRenderer`.
- Use Vite as the development/build tool unless the repository already has a sound equivalent.
- Keep game systems separate from rendering, UI, and persistence.
- Use typed domain models for rocket parts, vehicle configuration, missions, locations, and player progression.
- Use deterministic, testable functions for calculations such as mass, fuel, thrust-to-weight ratio, and mission readiness.
- Use a fixed or capped timestep for simulation updates. Avoid frame-rate-dependent physics.
- Dispose geometries, materials, textures, render targets, and event listeners when scenes or components are removed.
- Add loading, empty, error, and unsupported-WebGL states.
- No paid service or API key should be required for the core game.
- Do not download or include third-party assets without checking license and attribution requirements. Prefer procedural geometry and original placeholder art.
- Do not use copyrighted logos or present the game as affiliated with SpaceX, NASA, or any real space agency. An ISS-like station is a fictionalized educational analogue unless properly attributed assets are used.
- Do not state that simplified mechanics are scientifically exact.

## UX and navigation

The user must always be able to understand where they are and what to do next. Provide a persistent location selector with:
- **Rocket Factory**
- **Mission Control**
- **Launch Pad**
- Later: **Flight / Orbit**, **Orbital Station**, **Moon**, and **Mission Debrief**

Show the current location, stage objective, progress, warnings, and next action. Prevent invalid actions with clear explanations rather than silent failure. The scene selector must actually change the active scene/location and preserve game state.

## Art direction

- Industrial, premium, near-future spaceflight facility.
- Stainless-steel rocket body, dark structural steel, warm work lights, hazard markings, practical machinery, large hangar doors, gantries, cranes, service platforms, and subtle dust/haze.
- UI: clean mission-console aesthetic, high contrast, readable typography, restrained accent colors, accessible states.
- Use original procedural meshes and materials initially. Aim for a recognizable two-stage reusable launch vehicle silhouette: booster, upper stage/ship, nose cone, engines, fins/flaps, landing legs, tanks, grid/steering surfaces, payload/crew section, windows, and docking hardware where appropriate.

## Quality bar

- No giant monolithic component or scene file.
- No fake buttons: every visible control must work or be visibly disabled with a reason.
- No unhandled console errors during normal navigation.
- No unbounded animation loops or uncapped simulation steps.
- Keyboard and mouse navigation should work; include touch-friendly controls where reasonable.
- Test key pure logic with unit tests.
- The game should remain understandable even if a player skips optional tutorial text.

## Completion report

At the end of each stage, report:
- Implemented
- How to run
- How to test
- Known limitations
- Files changed
- Recommended next stage
Update `docs/STATUS.md`.
