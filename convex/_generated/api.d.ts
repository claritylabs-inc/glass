/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_classifyEmails from "../actions/classifyEmails.js";
import type * as actions_extractPolicy from "../actions/extractPolicy.js";
import type * as actions_retryExtraction from "../actions/retryExtraction.js";
import type * as actions_scanInbox from "../actions/scanInbox.js";
import type * as connections from "../connections.js";
import type * as emails from "../emails.js";
import type * as lib_aiClassifier from "../lib/aiClassifier.js";
import type * as lib_policyTypes from "../lib/policyTypes.js";
import type * as migrations from "../migrations.js";
import type * as policies from "../policies.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/classifyEmails": typeof actions_classifyEmails;
  "actions/extractPolicy": typeof actions_extractPolicy;
  "actions/retryExtraction": typeof actions_retryExtraction;
  "actions/scanInbox": typeof actions_scanInbox;
  connections: typeof connections;
  emails: typeof emails;
  "lib/aiClassifier": typeof lib_aiClassifier;
  "lib/policyTypes": typeof lib_policyTypes;
  migrations: typeof migrations;
  policies: typeof policies;
  seed: typeof seed;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
