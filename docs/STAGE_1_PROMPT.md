# Stage 1 prompt — Factory / Rocket Assembly Hall

After Stage 0 is reviewed and accepted, paste this prompt:

Implement **Stage 1 only** from `docs/ROADMAP.md`: Rocket Factory / Assembly Hall. Build an original procedural 3D industrial hangar and a modular reusable two-stage rocket from individual parts. The player must be able to browse the parts catalog, select a part, snap it to a compatible attachment point, remove/replace parts, inspect part details, see live rocket statistics, and save/load the blueprint. Include a guided starter build. Keep Mission Control and Launch Pad visible in the location selector but locked with clear unlock messages.

Use the `modular-rocket-assembly`, `threejs-scene-lifecycle`, and `game-ui-navigation` skills. Use the Three.js Engineer, Rocket Systems Engineer, UI/UX Designer, and QA Engineer agents as relevant. Write tests for attachment compatibility, stat calculations, validation, and save/load. Do not implement mission control, launch countdown, orbital flight, docking, or moon travel in this stage. Update `docs/STATUS.md`, run checks, report actual results, and stop for review.
