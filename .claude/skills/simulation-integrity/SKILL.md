---
name: simulation-integrity
description: Use for launch, ascent, orbital flight, rendezvous, docking, re-entry, or landing systems.
---

# Simulation Integrity Skill

- Keep calculations in pure, testable TypeScript modules where possible.
- Use SI units internally and explicit unit-bearing variable names.
- Use fixed or capped timestep integration.
- Define and document gameplay approximations.
- Never imply the game is an exact flight simulator.
- Keep vehicle mass, propellant use, thrust, and stage transitions internally consistent enough for gameplay.
- Provide assisted and manual control modes when feasible.
- Always include pause and abort behavior for high-risk sequences.
- For docking, evaluate relative speed, distance, and alignment rather than triggering success from proximity alone.
- For landing, make controls, telemetry, target and failure conditions understandable.
- Test boundary conditions such as zero fuel, low thrust, missing hardware, and invalid mission configuration.
