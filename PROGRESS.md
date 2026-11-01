# PROGRESS

## Current phase
**Phase 0 — feasibility spike and map-engine decision.** Phase 1 must not start until the owner approves the engine.

## Status of P10.5 acceptance criteria
| Criterion | Status | Evidence |
| --- | --- | --- |
| 3D terrain stable on owner's phone, ≥ 30 FPS rotating/tilting | Not run | needs phone |
| Hillshade + contours readable z12–16 in daylight | Not run | needs phone |
| Encoding test (Meron, coast, Dead Sea) fails loudly if wrong | Not run | — |
| Contour labels and trails legible when tilted | Not run | needs phone |
| Owner quality review vs FATMAP screenshots | Not run | needs screenshots |
| DECISIONS.md records engine, contours, hosting, attribution, open issues | In progress | — |

## Completed tasks
- 2026-11-01: repo created; README, DECISIONS, PROGRESS, .env.example, .gitignore.

## Blockers
- Workspace network: only GitHub reachable (see DECISIONS D-002). No device link.
- Waiting for owner inputs (DECISIONS → Open questions).

## Next task
Research VERIFY items; build `packages/geo` with tests; Topo3D style; Option B page.
