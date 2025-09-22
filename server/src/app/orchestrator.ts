/**
 * Barrel re-export kept for backwards compatibility.
 *
 * The orchestrator implementation moved under `src/app/orchestrator/` but
 * existing code still imports from `src/app/orchestrator.js`. This wrapper
 * forwards those imports to the new module.
 */
export * from "./orchestrator/index.js";