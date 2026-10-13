# Project Status

## Current stage
**Stage 3: Mission Control.** Complete and waiting for review.

## Completed
- **Stage 0:** foundation (Vite, React, Zustand, Three.js, strict TypeScript; scene lifecycle; location selector).
- **Stage 1:** Rocket Factory / Assembly Hall. Procedural hangar, modular parts, snapping, guided build, stats, autosave.
- **Stage 2:** vehicle readiness and certification, design library, undo/redo, part variants and finishes, budget/research/milestones, the Structure list, save v2.
- **Stage 3:**
  - **Mission catalog** (`src/missions/missionCatalog.ts`), with progressive unlocks:
    - Uncrewed Test Flight and Crewed Orbital Shakedown are available now.
    - Station Crew Rotation needs the orbital flight completed; Lunar Flyby needs the station mission.
    - Lunar Landing is shown as a later stage.
    - Each mission has a briefing, objectives, abort criteria, duration, a gameplay Δv requirement, equipment rules, payload options and rewards.
  - **Payloads:** six fictional payloads with mass. Some need a Cargo Bay.
  - **Crew roster** (`crew.ts`): 7 fictional astronauts with roles (Commander, Pilot, Flight Engineer, Mission Specialist), skill 1–5 and status:
    - Ready.
    - Fatigued: assignable, but raises risk.
    - Medical hold: refused at assignment, and blocking if it comes from old data.
  - **Launch window and weather** (`conditions.ts`), generated from a seed:
    - Factors: surface wind, upper-level shear, lightning, cloud ceiling, recovery sea state.
    - Red blocks commitment, amber adds risk.
    - "Wait for next window" is free and draws new conditions.
  - **Mission readiness** (`missionReadiness.ts`): a flight-director **GO/NO-GO poll** across Vehicle, Propulsion/Δv, Crew, Life support, Guidance (RCS), Communications, Payload and Weather. Each issue explains itself and has a fix action. Checks:
    - an assigned, certified vehicle with an unexpired certification; an override certification is a warning;
    - a crew-role vehicle for crewed flights;
    - re-entry hardware;
    - Δv including payload and crew mass (150 kg per crew member);
    - crew size against seats, plus Commander and Pilot present and a Flight Engineer on long flights;
    - life support (crew × days against the cabin's 60 crew-days plus 40 per solar array);
    - a docking adapter and RCS where required, and an antenna;
    - payload bay requirements, and weather.
    - It also estimates mission risk from mission difficulty, weather, fatigue, override and crew experience.
  - **Mission setup** (`missionSetup.ts`): mission, vehicle, payload, crew, launch-window seed and commitment. It is persisted and survives location changes and reloads. Any planning change clears the commitment.
  - **Commit mission (GO for rollout):** refused while the poll is NO-GO. A commitment records the design and its revision, and becomes **void** if the design changes. The Launch Pad (Stage 4) will consume it.
  - **Mission rewards:** `completeMission()` records the first successful flight. Budget and RP are derived from completed missions. Flights that call it arrive in Stage 4 and 5.
  - **3D Mission Control room** (`src/scenes/mission-control/`):
    - Tiered console rows, a director's podium, a glass gallery, ceiling light panels and screen glow.
    - Three wall screens drawn from live mission data: the main overview with a trajectory schematic and status, the GO/NO-GO poll, and weather and window.
    - A limited orbit camera with reset.
    - Factory and Mission Control share the one renderer. Leaving the factory now disables its camera input.
  - **UI:**
    - Mission list with requirements, lock reasons and rewards.
    - Briefing, Manifest, Readiness and Conditions tabs.
    - Commit/stand-down bar with a "Why not?" shortcut.
    - Fix buttons can jump back to the factory's Readiness or Designs tab.
    - Mobile Missions and Plan tabs.
  - **Save format v3:** adds the mission plan and completed missions, with a v2→v3 migration. An unreadable plan, unknown crew or a missing design are dropped with a warning.

## Assumptions (documented, reversible)
- Mission Δv requirements, durations, life-support figures, crew mass, weather limits and risk are simplified game values. The UI labels them as such.
- Crew statuses are fixed in this stage; flights will change them later.
- The current location isn't saved, so a reload always opens the factory. The mission plan is saved.
- Waiting for a launch window is free and instant.

## Checks (last run)
- `npm run typecheck`, `npm run lint`: pass.
- `npm test`: 113 tests pass across 13 files. New this stage:
  - catalog and unlocks;
  - setup rules (switching missions, crew rules, commitment clearing);
  - deterministic conditions and ratings;
  - every mission-readiness area, commit and void;
  - rewards;
  - v2→v3 migration and mission-plan recovery;
  - store flows (plan → commit → factory round trip → void on edit; fix routing; locked missions).
- `npm run build`: pass. The bundle is about 994 kB minified (271 kB gzip).
- Headless Chromium smoke test (manual script, not committed), with no console errors or warnings:
  - certify, then plan the crewed orbital flight;
  - a locked mission explains itself and the medical-hold astronaut is disabled;
  - a weather NO-GO clears by waiting, and the commit succeeds;
  - 4 factory ↔ Mission Control round trips keep one canvas and the commitment;
  - a factory edit voids the commitment;
  - a reload keeps the crew;
  - the mobile layout works.

## Known limitations
- The side wall screens are partly hidden behind the HUD panels on desktop. The HUD shows the same information, and the camera can orbit to see them.
- The bundle is approaching 1 MB minified; code-splitting by location is the next easy win.
- Rewards can't be earned yet because flights don't exist until Stage 4/5.

## Next action
Review Stage 3. When it is approved, begin **Stage 4: Launch Pad and countdown**: roll out the committed vehicle, run the countdown checklist, and fly a basic ascent.
