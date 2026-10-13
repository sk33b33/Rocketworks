# Definition of Done

A stage is done only when the relevant items below are satisfied.

## Functional
- The requested stage goal is implemented end to end.
- Every enabled button/control performs its described action.
- Disabled controls explain why they are disabled.
- State survives location changes when it should.
- Errors are shown to the player in useful language.

## Technical
- TypeScript typecheck passes.
- Production build passes.
- Tests for pure logic pass.
- No new obvious console errors or warnings during normal use.
- Event listeners, timers, animation loops and Three.js resources are cleaned up correctly.
- No secrets or API keys are required or committed.

## UX
- Main actions are visible without hunting.
- Current location and next objective are clear.
- Keyboard and pointer behavior is predictable.
- UI scales to common desktop widths and remains usable on mobile.
- Important telemetry and labels have accessible contrast and non-color status cues.

## Visual
- Visuals match the industrial near-future spaceflight art direction.
- Camera starts at a useful angle and has a reset option.
- Lighting makes the rocket silhouette and parts readable.
- Placeholder assets are intentional, not accidental gray boxes unless the stage specifically calls for scaffolding.

## Handoff
- `docs/STATUS.md` is updated.
- README contains accurate run commands.
- Stage report states what is implemented, tested, incomplete, and next.
