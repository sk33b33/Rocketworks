# Rocketworks — Claude Code Game Development Package

A staged project scaffold and instruction package for building a browser-based 3D rocket construction and spaceflight game with Three.js/WebGL.

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
