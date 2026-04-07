import { getModel } from "./models";

/**
 * @deprecated Use `getModel("classification")` from `./models` instead.
 * Kept for backward compat during migration.
 */
export const haikuModel = getModel("classification");

/**
 * @deprecated Use `getModel("extraction")` from `./models` instead.
 */
export const sonnetModel = getModel("extraction");
