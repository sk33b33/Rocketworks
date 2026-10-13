---
name: modular-rocket-assembly
description: Use when implementing the parts catalog, attachment points, snap placement, blueprint rendering, or rocket validation.
---

# Modular Rocket Assembly Skill

## Data first
Define typed part definitions separately from placed instances. Each part definition should describe:
- identity, name, category and description
- dry mass and cost
- optional propellant capacity, thrust, crew capacity, and capability tags
- attachment sockets and compatibility rules
- procedural visual recipe
- unlock status or requirement

## Assembly
- Every attachable part must have one or more named sockets.
- A connection records parent instance, parent socket, child instance, and child socket.
- Validate compatibility before committing a connection.
- Snap the child transform to the socket transform.
- Show available sockets and invalid connection feedback.
- Support selection, inspection, removal, and replacement.
- Recalculate stats from the blueprint after each change.

## Rendering
- Build meshes from part definitions and transforms.
- Keep meshes mapped to instance IDs so clicking a mesh selects the correct part.
- The same blueprint should render in factory, pad, and flight contexts.
- Use procedural geometry initially and do not require paid assets.

## Validation
Start with clear rules such as:
- A vehicle needs a valid main body/stack.
- Engine(s) must be attached to a propulsion stage.
- Stages need valid structural connections.
- Crew missions require a crew-rated upper stage and enough seats.
- A mission requiring docking needs a docking adapter.
- Landing/reuse missions need landing hardware and sufficient recovery propellant.

All rules should be deterministic and covered by unit tests.
