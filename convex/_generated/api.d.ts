/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_backfillChunks from "../actions/backfillChunks.js";
import type * as actions_classifyEmails from "../actions/classifyEmails.js";
import type * as actions_dailyScan from "../actions/dailyScan.js";
import type * as actions_dreamConsolidation from "../actions/dreamConsolidation.js";
import type * as actions_extractChatIntelligence from "../actions/extractChatIntelligence.js";
import type * as actions_extractCompanyInfo from "../actions/extractCompanyInfo.js";
import type * as actions_extractEmailIntelligence from "../actions/extractEmailIntelligence.js";
import type * as actions_extractFromDocument from "../actions/extractFromDocument.js";
import type * as actions_extractFromUpload from "../actions/extractFromUpload.js";
import type * as actions_extractPolicy from "../actions/extractPolicy.js";
import type * as actions_extractSupplementary from "../actions/extractSupplementary.js";
import type * as actions_generateCoi from "../actions/generateCoi.js";
import type * as actions_generateEmailBody from "../actions/generateEmailBody.js";
import type * as actions_handleInboundEmail from "../actions/handleInboundEmail.js";
import type * as actions_mcpChat from "../actions/mcpChat.js";
import type * as actions_migrateIntelligence from "../actions/migrateIntelligence.js";
import type * as actions_proactiveAnalysis from "../actions/proactiveAnalysis.js";
import type * as actions_processApplication from "../actions/processApplication.js";
import type * as actions_processThreadChat from "../actions/processThreadChat.js";
import type * as actions_processWebChat from "../actions/processWebChat.js";
import type * as actions_reExtractFromFile from "../actions/reExtractFromFile.js";
import type * as actions_rechunkPolicy from "../actions/rechunkPolicy.js";
import type * as actions_retryExtraction from "../actions/retryExtraction.js";
import type * as actions_scanGmail from "../actions/scanGmail.js";
import type * as actions_scanInbox from "../actions/scanInbox.js";
import type * as actions_sendPendingEmail from "../actions/sendPendingEmail.js";
import type * as actions_triageEmails from "../actions/triageEmails.js";
import type * as actions_vectorProjection from "../actions/vectorProjection.js";
import type * as agentConversations from "../agentConversations.js";
import type * as apiKeys from "../apiKeys.js";
import type * as applicationSessions from "../applicationSessions.js";
import type * as auth from "../auth.js";
import type * as businessContext from "../businessContext.js";
import type * as connections from "../connections.js";
import type * as conversationTurns from "../conversationTurns.js";
import type * as crons from "../crons.js";
import type * as documentChunks from "../documentChunks.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as intelligence from "../intelligence.js";
import type * as lib_agentEmailTemplate from "../lib/agentEmailTemplate.js";
import type * as lib_agentPrompts from "../lib/agentPrompts.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_aiClassifier from "../lib/aiClassifier.js";
import type * as lib_aiUtils from "../lib/aiUtils.js";
import type * as lib_applicationPrompts from "../lib/applicationPrompts.js";
import type * as lib_applicationTypes from "../lib/applicationTypes.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_chatTools from "../lib/chatTools.js";
import type * as lib_coiGenerator from "../lib/coiGenerator.js";
import type * as lib_convexDocumentStore from "../lib/convexDocumentStore.js";
import type * as lib_convexMemoryStore from "../lib/convexMemoryStore.js";
import type * as lib_documentMapping from "../lib/documentMapping.js";
import type * as lib_emailTemplate from "../lib/emailTemplate.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_industries from "../lib/industries.js";
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_models from "../lib/models.js";
import type * as lib_orgAuth from "../lib/orgAuth.js";
import type * as lib_orgMemoryContext from "../lib/orgMemoryContext.js";
import type * as lib_pdfFiller from "../lib/pdfFiller.js";
import type * as lib_policyTypes from "../lib/policyTypes.js";
import type * as lib_queryAgent from "../lib/queryAgent.js";
import type * as lib_sdkCallbacks from "../lib/sdkCallbacks.js";
import type * as migrations from "../migrations.js";
import type * as migrations_migrateOnboarding from "../migrations/migrateOnboarding.js";
import type * as migrations_migrateToOrgs from "../migrations/migrateToOrgs.js";
import type * as migrations_migrateToThreads from "../migrations/migrateToThreads.js";
import type * as oauth from "../oauth.js";
import type * as orgMemory from "../orgMemory.js";
import type * as orgs from "../orgs.js";
import type * as pendingEmails from "../pendingEmails.js";
import type * as policies from "../policies.js";
import type * as policyAuditLog from "../policyAuditLog.js";
import type * as presence from "../presence.js";
import type * as seed from "../seed.js";
import type * as threads from "../threads.js";
import type * as users from "../users.js";
import type * as webChats from "../webChats.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/backfillChunks": typeof actions_backfillChunks;
  "actions/classifyEmails": typeof actions_classifyEmails;
  "actions/dailyScan": typeof actions_dailyScan;
  "actions/dreamConsolidation": typeof actions_dreamConsolidation;
  "actions/extractChatIntelligence": typeof actions_extractChatIntelligence;
  "actions/extractCompanyInfo": typeof actions_extractCompanyInfo;
  "actions/extractEmailIntelligence": typeof actions_extractEmailIntelligence;
  "actions/extractFromDocument": typeof actions_extractFromDocument;
  "actions/extractFromUpload": typeof actions_extractFromUpload;
  "actions/extractPolicy": typeof actions_extractPolicy;
  "actions/extractSupplementary": typeof actions_extractSupplementary;
  "actions/generateCoi": typeof actions_generateCoi;
  "actions/generateEmailBody": typeof actions_generateEmailBody;
  "actions/handleInboundEmail": typeof actions_handleInboundEmail;
  "actions/mcpChat": typeof actions_mcpChat;
  "actions/migrateIntelligence": typeof actions_migrateIntelligence;
  "actions/proactiveAnalysis": typeof actions_proactiveAnalysis;
  "actions/processApplication": typeof actions_processApplication;
  "actions/processThreadChat": typeof actions_processThreadChat;
  "actions/processWebChat": typeof actions_processWebChat;
  "actions/reExtractFromFile": typeof actions_reExtractFromFile;
  "actions/rechunkPolicy": typeof actions_rechunkPolicy;
  "actions/retryExtraction": typeof actions_retryExtraction;
  "actions/scanGmail": typeof actions_scanGmail;
  "actions/scanInbox": typeof actions_scanInbox;
  "actions/sendPendingEmail": typeof actions_sendPendingEmail;
  "actions/triageEmails": typeof actions_triageEmails;
  "actions/vectorProjection": typeof actions_vectorProjection;
  agentConversations: typeof agentConversations;
  apiKeys: typeof apiKeys;
  applicationSessions: typeof applicationSessions;
  auth: typeof auth;
  businessContext: typeof businessContext;
  connections: typeof connections;
  conversationTurns: typeof conversationTurns;
  crons: typeof crons;
  documentChunks: typeof documentChunks;
  emails: typeof emails;
  http: typeof http;
  intelligence: typeof intelligence;
  "lib/agentEmailTemplate": typeof lib_agentEmailTemplate;
  "lib/agentPrompts": typeof lib_agentPrompts;
  "lib/ai": typeof lib_ai;
  "lib/aiClassifier": typeof lib_aiClassifier;
  "lib/aiUtils": typeof lib_aiUtils;
  "lib/applicationPrompts": typeof lib_applicationPrompts;
  "lib/applicationTypes": typeof lib_applicationTypes;
  "lib/auth": typeof lib_auth;
  "lib/chatTools": typeof lib_chatTools;
  "lib/coiGenerator": typeof lib_coiGenerator;
  "lib/convexDocumentStore": typeof lib_convexDocumentStore;
  "lib/convexMemoryStore": typeof lib_convexMemoryStore;
  "lib/documentMapping": typeof lib_documentMapping;
  "lib/emailTemplate": typeof lib_emailTemplate;
  "lib/extraction": typeof lib_extraction;
  "lib/industries": typeof lib_industries;
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/models": typeof lib_models;
  "lib/orgAuth": typeof lib_orgAuth;
  "lib/orgMemoryContext": typeof lib_orgMemoryContext;
  "lib/pdfFiller": typeof lib_pdfFiller;
  "lib/policyTypes": typeof lib_policyTypes;
  "lib/queryAgent": typeof lib_queryAgent;
  "lib/sdkCallbacks": typeof lib_sdkCallbacks;
  migrations: typeof migrations;
  "migrations/migrateOnboarding": typeof migrations_migrateOnboarding;
  "migrations/migrateToOrgs": typeof migrations_migrateToOrgs;
  "migrations/migrateToThreads": typeof migrations_migrateToThreads;
  oauth: typeof oauth;
  orgMemory: typeof orgMemory;
  orgs: typeof orgs;
  pendingEmails: typeof pendingEmails;
  policies: typeof policies;
  policyAuditLog: typeof policyAuditLog;
  presence: typeof presence;
  seed: typeof seed;
  threads: typeof threads;
  users: typeof users;
  webChats: typeof webChats;
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
