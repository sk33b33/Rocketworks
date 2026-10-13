---
name: game-ui-navigation
description: Use when implementing the persistent location selector, scene transitions, locked locations, or navigation between factory, mission control, pad, and space.
---

# Game UI Navigation Skill

Persistent destinations:
- Rocket Factory
- Mission Control
- Launch Pad
- Flight / Orbit
- Orbital Station
- Moon

Each destination has a stable ID, display name, availability condition, status, and scene route. Navigation must:
- Switch the real active scene/location.
- Preserve the blueprint and mission state.
- Show locked destinations with an unlock reason.
- Keep the active destination visually and semantically clear.
- Provide a return route to the previous operational location where appropriate.
- Avoid loading unimplemented destinations as blank scenes.
- Show the player's current objective and a next-step action.

Test every available transition and verify that returning to the factory preserves the build.
