import { getModel } from "./models";
import { HAIKU_MODEL, SONNET_MODEL } from "./extraction";

// Re-export model constants for backward compat
export { HAIKU_MODEL, SONNET_MODEL };

/**
 * @deprecated Use `getModel("classification")` from `./models` instead.
 * Kept for backward compat during migration.
 */
export const haikuModel = getModel("classification");

/**
 * @deprecated Use `getModel("extraction")` from `./models` instead.
 */
export const sonnetModel = getModel("extraction");
