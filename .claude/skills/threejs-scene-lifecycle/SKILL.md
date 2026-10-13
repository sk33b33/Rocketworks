---
name: threejs-scene-lifecycle
description: Use when creating, switching, or disposing Three.js scenes, render loops, cameras, or GPU resources.
---

# Three.js Scene Lifecycle Skill

- Create one long-lived WebGLRenderer unless the existing app architecture clearly requires otherwise.
- Keep scene-specific objects inside scene modules.
- Use an explicit lifecycle contract: create, enter, update, exit, dispose.
- Dispose of geometries, materials, textures, render targets, controls and event listeners when owned by the scene.
- Do not dispose shared resources until their owner is done with them.
- Handle resize, tab visibility, WebGL context loss where practical, and unsupported WebGL gracefully.
- Cap delta time after tab suspension; don't simulate a giant time jump.
- Avoid creating duplicate animation loops when changing location.
- Verify scene switching several times in a row and watch for duplicate objects or steadily increasing resource use.
