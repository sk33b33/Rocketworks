# Project Status

## Current stage
**Stage 0: Project foundation.** Complete and waiting for review.

## Completed
- Project brief, staged roadmap, architecture and quality criteria.
- Stage 0 foundation:
  - Vite, React 19, Zustand 5, Three.js r186 and TypeScript (strict, `noUncheckedIndexedAccess`).
  - One long-lived `WebGLRenderer` owned by `GameRuntime` (`src/game/GameRuntime.ts`). Resizes through a `ResizeObserver` on the viewport, caps pixel ratio at 2, pauses when the tab is hidden, and handles WebGL context loss.
  - Scene lifecycle contract `GameScene` (create / enter / update / resize / exit / dispose) and a `SceneManager` that creates scenes lazily, reuses them and disposes them.
  - `RenderLoop`: a single idempotent requestAnimationFrame loop. Frame delta is capped at 0.1 s.
  - Typed location registry (`src/app/locations.ts`) and a pure navigation reducer (`src/app/gameState.ts`), wrapped by a Zustand store (`src/app/gameStore.ts`).
  - Persistent location selector. Only Rocket Factory is enabled. Locked locations show a lock icon, a dashed border and a tooltip. Clicking one shows a notice explaining why it is locked.
  - Objective panel showing the location, objective, next action and progress.
  - Loading, render error (error boundary), unsupported-WebGL 2 and GPU-context-lost screens.
  - ESLint (flat config, typescript-eslint, react-hooks), Prettier, Vitest.

## Checks (last run)
- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm test`: 13 tests pass (locations, navigation and store, SceneManager lifecycle order, delta clamping)
- `npm run build`: pass. The bundle is about 764 kB minified (205 kB gzip), mostly Three.js. Code-splitting is deferred.
- Headless Chromium smoke test (manual script, not committed): canvas renders, no console errors or warnings, clicking a locked location shows its reason, and the canvas resizes to a 390 px wide mobile viewport.

## Known limitations
- The factory scene is a **temporary placeholder**: floor, grid, an assembly-marker disc and a slowly orbiting camera. The real assembly hall and orbit controls arrive in Stage 1.
- No persistence yet. Save/load with schema versioning is planned for Stage 1.
- No Playwright test suite yet (deferred by agreement).
- Recovering from context loss requires a page reload.

## Next action
Review Stage 0. When it is approved, begin **Stage 1: Rocket Factory / Assembly Hall** (see `docs/STAGE_1_PROMPT.md`).
