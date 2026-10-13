---
name: staged-development
description: Use for every implementation request to keep work scoped to one runnable milestone at a time.
---

# Staged Development Skill

1. Read `docs/ROADMAP.md`, `docs/STATUS.md`, and `docs/DEFINITION_OF_DONE.md`.
2. Identify the current stage. If unclear, ask one concise question or infer from STATUS.
3. Summarize scope, files, risks, and test plan before coding.
4. Implement only the current stage.
5. Run the checks available in the repo.
6. Fix issues caused by the change.
7. Update `docs/STATUS.md`.
8. Provide a completion report with run/test instructions and known limitations.
9. Stop and wait for approval before starting another stage.

Do not create speculative systems for distant stages merely because they are in the roadmap. Add only the minimal interfaces required to avoid blocking the current stage.
