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
import type * as actions_extractCompanyInfo from "../actions/extractCompanyInfo.js";
import type * as actions_extractPolicy from "../actions/extractPolicy.js";
import type * as actions_handleInboundEmail from "../actions/handleInboundEmail.js";
import type * as actions_reExtractFromFile from "../actions/reExtractFromFile.js";
import type * as actions_retryExtraction from "../actions/retryExtraction.js";
import type * as actions_scanInbox from "../actions/scanInbox.js";
import type * as agentConversations from "../agentConversations.js";
import type * as auth from "../auth.js";
import type * as connections from "../connections.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as lib_agentEmailTemplate from "../lib/agentEmailTemplate.js";
import type * as lib_agentPrompts from "../lib/agentPrompts.js";
import type * as lib_aiClassifier from "../lib/aiClassifier.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_emailTemplate from "../lib/emailTemplate.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_industries from "../lib/industries.js";
import type * as lib_policyTypes from "../lib/policyTypes.js";
import type * as lib_prompts from "../lib/prompts.js";
import type * as migrations from "../migrations.js";
import type * as migrations_migrateOnboarding from "../migrations/migrateOnboarding.js";
import type * as policies from "../policies.js";
import type * as seed from "../seed.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/classifyEmails": typeof actions_classifyEmails;
  "actions/extractCompanyInfo": typeof actions_extractCompanyInfo;
  "actions/extractPolicy": typeof actions_extractPolicy;
  "actions/handleInboundEmail": typeof actions_handleInboundEmail;
  "actions/reExtractFromFile": typeof actions_reExtractFromFile;
  "actions/retryExtraction": typeof actions_retryExtraction;
  "actions/scanInbox": typeof actions_scanInbox;
  agentConversations: typeof agentConversations;
  auth: typeof auth;
  connections: typeof connections;
  emails: typeof emails;
  http: typeof http;
  "lib/agentEmailTemplate": typeof lib_agentEmailTemplate;
  "lib/agentPrompts": typeof lib_agentPrompts;
  "lib/aiClassifier": typeof lib_aiClassifier;
  "lib/auth": typeof lib_auth;
  "lib/emailTemplate": typeof lib_emailTemplate;
  "lib/extraction": typeof lib_extraction;
  "lib/industries": typeof lib_industries;
  "lib/policyTypes": typeof lib_policyTypes;
  "lib/prompts": typeof lib_prompts;
  migrations: typeof migrations;
  "migrations/migrateOnboarding": typeof migrations_migrateOnboarding;
  policies: typeof policies;
  seed: typeof seed;
  users: typeof users;
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
