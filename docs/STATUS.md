# Project Status

## Current stage
**Stage 2: Factory polish and vehicle validation.** Complete and waiting for review.

## Completed
- **Stage 0:** foundation. Vite, React, Zustand, Three.js and strict TypeScript; a single renderer; the scene lifecycle; the location selector; loading, error and unsupported-WebGL screens.
- **Stage 1:** Rocket Factory / Assembly Hall. Procedural hangar, a modular parts catalog, socket-based snapping, a guided starter build, live stats and autosave.
- **Stage 2:**
  - **Vehicle readiness** (`src/rocket/readiness/`):
    - Deterministic rules, each with severity, explanation, fix text and a one-click fix action. The rules cover:
      - an empty stand, booster or ship engines missing or only partly fitted, and an uncapped booster;
      - no upper stage, or a ship with an open top (no nose cone);
      - liftoff TWR below 1 or marginal, too little Δv for orbit, and a ship too heavy for its booster;
      - vacuum engines on the booster, which the stages can't use together;
      - asymmetric grid fins, and no booster recovery hardware;
      - gaps in heat-shield coverage and missing flaps (critical for crew, warnings for cargo);
      - no crew cabin for a crew-role design, and no payload bay for a cargo-role design;
      - unresearched parts, and over budget.
    - A capability summary: orbit, crew, cargo, docking, booster recovery, ship re-entry.
    - Simplified two-stage **Δv estimate** (ideal rocket equation, thrust-weighted Isp per stage). The gameplay requirement is 9,200 m/s to orbit, plus a 400 m/s crew reserve; losses are folded into that figure.
    - **Design role** (Cargo / Crew) per design.
  - **Flight certification gate** (`certification.ts`):
    - A design with critical issues is refused unless the **tutorial override** is ticked; that certification is marked as an override.
    - Certifications are tied to the design revision and expire on any design change or role change. Undo can restore a certified revision.
    - Stage 3 (Mission Control) will accept only certified designs.
  - **Design library** (`src/rocket/library/`): up to 12 named designs, with new, duplicate, rename, delete (keeps at least one) and switch. Reset to starter and load reference design apply to the active design.
  - **Undo/redo** for all design edits (100 steps per design session). Shortcuts are Ctrl/Cmd+Z, Ctrl+Shift+Z and Ctrl+Y, plus toolbar buttons.
  - **Part variants and finishes:**
    - Booster Tank Section (Short) is unlocked.
    - Forge-SL Block 2 engine is a research unlock.
    - Engines now have sea-level and vacuum Isp.
    - Three cosmetic hull finishes (Brushed steel, Mirror polish, Flight-proven with procedural soot). Finishes don't change stats or certification.
  - **Program progression** (`src/progression/`):
    - **Budget model:** credits are a program budget that caps one design's cost. Nothing is spent or refunded, so there is no grind and undo and duplicate stay simple. Over-budget additions are refused with a reason; reductions are always allowed.
    - **7 one-time milestones** award research points (RP), and some also raise the budget.
    - A **5-node tech tree** unlocks the extended tank, vacuum engine, Block 2 engine and solar array, plus a +50,000 cr budget node. Milestones give 9 RP against an 11 RP tree, so you have to choose.
    - Progress is stored only as achieved milestones and purchased tech; everything else is derived.
  - **List-based assembly mode:** "Structure list" tab with the main stack from bottom to top. Each section lists its attachments; empty points (＋) open a list of parts that fit and are unlocked. Everything can be built without the 3D view.
  - **Save format v2:**
    - Contents: the design library, active design, progression and UI preferences.
    - Migration v1→v2: a Stage 1 save becomes a one-design library and the player is told.
    - Partial recovery: damaged or duplicate designs are skipped with a warning; unknown milestone or tech IDs and invalid cosmetic fields are cleaned up. The original raw save is backed up whenever anything was dropped.
    - Load-time notices stay until dismissed.
  - **UI:**
    - The right column has a design bar (name, certification badge, RP) with Stats, Readiness, Program and Designs tabs.
    - The left column has Parts catalog and Structure list tabs.
    - The catalog shows the budget left and each part's cost, and marks unaffordable parts with ✕.
    - The inspector shows research-locked replacements with reasons.
    - Mobile tabs: Guide, Build, Selected, Vehicle.

## Assumptions (documented, reversible)
- No fabrication timers. The roadmap marks them optional, and they would only add waiting.
- The starting budget is 150,000 cr; the reference design costs 136,700 cr.
- Δv, Isp, TWR thresholds and masses are game-tuned values, and the UI labels them as simplified.
- Milestones are never revoked, even if the design that earned one is later changed or deleted.
- Undo history is per session and is cleared when switching designs.

## Checks (last run)
- `npm run typecheck`, `npm run lint`: pass.
- `npm test`: 88 tests pass across 12 files. New this stage:
  - every readiness rule, Δv against the rocket equation, and certification and expiry;
  - research, budget and milestones;
  - library operations;
  - v2 round trip, v1→v2 migration, partial recovery and sanitizing;
  - store flows: undo/redo, the budget gate, certification, design switching, research, fix actions.
- `npm run build`: pass. The bundle is about 949 kB minified (258 kB gzip), mostly Three.js.
- Headless Chromium smoke test (manual script, not committed), with no console errors or warnings:
  - a v1 save migrates and shows a notice;
  - the blocked readiness report lists fixes, and a fix button selects the right part;
  - the guided build reaches "Ready for flight", certification awards milestones, and Block 2 research unlocks;
  - attaching through the Structure list expires the certification, and undo restores it;
  - duplicating a design awards "Design bureau";
  - the Flight-proven finish renders;
  - a reload preserves designs, the active design and RP;
  - the mobile Vehicle tab works.

## Known limitations
- Bundle size: code-splitting is still deferred.
- There's no prompt before switching designs; switching is non-destructive, but it clears the undo history.
- Δv ignores staging losses beyond the folded-in requirement and treats booster Isp as a sea-level/vacuum average.
- The Structure list rebuilds fully on every change. Fine at about 50 parts; it may need virtualization for much larger designs.
- No Playwright suite is committed yet.

## Next action
Review Stage 2. When it is approved, begin **Stage 3: Mission Control**: mission selection, crew roster and manifest, readiness against the mission, and taking a certified design to the pad.
