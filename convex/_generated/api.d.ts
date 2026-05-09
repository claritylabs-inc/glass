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
import type * as actions_detectDuplicatePolicies from "../actions/detectDuplicatePolicies.js";
import type * as actions_extractCompanyInfo from "../actions/extractCompanyInfo.js";
import type * as actions_extractFromUpload from "../actions/extractFromUpload.js";
import type * as actions_extractSupplementary from "../actions/extractSupplementary.js";
import type * as actions_generateCoi from "../actions/generateCoi.js";
import type * as actions_generateEmailBody from "../actions/generateEmailBody.js";
import type * as actions_handleInboundEmail from "../actions/handleInboundEmail.js";
import type * as actions_handleInboundImessage from "../actions/handleInboundImessage.js";
import type * as actions_mcpChat from "../actions/mcpChat.js";
import type * as actions_policyChangeRequests from "../actions/policyChangeRequests.js";
import type * as actions_policyExtraction from "../actions/policyExtraction.js";
import type * as actions_processThreadChat from "../actions/processThreadChat.js";
import type * as actions_processWebChat from "../actions/processWebChat.js";
import type * as actions_reExtractFromFile from "../actions/reExtractFromFile.js";
import type * as actions_rechunkPolicy from "../actions/rechunkPolicy.js";
import type * as actions_reconcilePolicy from "../actions/reconcilePolicy.js";
import type * as actions_retryExtraction from "../actions/retryExtraction.js";
import type * as actions_sendIntroImessage from "../actions/sendIntroImessage.js";
import type * as actions_sendNotificationEmail from "../actions/sendNotificationEmail.js";
import type * as actions_sendPendingEmail from "../actions/sendPendingEmail.js";
import type * as actions_threadTitle from "../actions/threadTitle.js";
import type * as actions_updateDocumentChunk from "../actions/updateDocumentChunk.js";
import type * as agentConversations from "../agentConversations.js";
import type * as apiAuditLog from "../apiAuditLog.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as brokerActivity from "../brokerActivity.js";
import type * as certificates from "../certificates.js";
import type * as clientInvitations from "../clientInvitations.js";
import type * as clientInvitationsTest from "../clientInvitationsTest.js";
import type * as clients from "../clients.js";
import type * as connectedOrgs from "../connectedOrgs.js";
import type * as conversationTurns from "../conversationTurns.js";
import type * as crons from "../crons.js";
import type * as devClear from "../devClear.js";
import type * as documentChunks from "../documentChunks.js";
import type * as http from "../http.js";
import type * as imessageInboundEvents from "../imessageInboundEvents.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_accessTests from "../lib/accessTests.js";
import type * as lib_actionFailures from "../lib/actionFailures.js";
import type * as lib_agentEmailTemplate from "../lib/agentEmailTemplate.js";
import type * as lib_agentPrompts from "../lib/agentPrompts.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_aiClassifier from "../lib/aiClassifier.js";
import type * as lib_aiUtils from "../lib/aiUtils.js";
import type * as lib_apiAuth from "../lib/apiAuth.js";
import type * as lib_apiDto from "../lib/apiDto.js";
import type * as lib_apiError from "../lib/apiError.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_branding from "../lib/branding.js";
import type * as lib_brokerActivity from "../lib/brokerActivity.js";
import type * as lib_chatTools from "../lib/chatTools.js";
import type * as lib_coiGenerator from "../lib/coiGenerator.js";
import type * as lib_convexDocumentStore from "../lib/convexDocumentStore.js";
import type * as lib_convexMemoryStore from "../lib/convexMemoryStore.js";
import type * as lib_convexSourceRetriever from "../lib/convexSourceRetriever.js";
import type * as lib_documentMapping from "../lib/documentMapping.js";
import type * as lib_emailPolicySources from "../lib/emailPolicySources.js";
import type * as lib_emailSubagent from "../lib/emailSubagent.js";
import type * as lib_emailTemplate from "../lib/emailTemplate.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_imessageConfig from "../lib/imessageConfig.js";
import type * as lib_industries from "../lib/industries.js";
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_mergePdfs from "../lib/mergePdfs.js";
import type * as lib_modelCatalog from "../lib/modelCatalog.js";
import type * as lib_models from "../lib/models.js";
import type * as lib_notificationEmailTemplate from "../lib/notificationEmailTemplate.js";
import type * as lib_notificationTypes from "../lib/notificationTypes.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_orgAuth from "../lib/orgAuth.js";
import type * as lib_orgMemoryContext from "../lib/orgMemoryContext.js";
import type * as lib_orgRelationships from "../lib/orgRelationships.js";
import type * as lib_pdfFiller from "../lib/pdfFiller.js";
import type * as lib_pdfSourceSpans from "../lib/pdfSourceSpans.js";
import type * as lib_pipelineMutations from "../lib/pipelineMutations.js";
import type * as lib_policyLookup from "../lib/policyLookup.js";
import type * as lib_policyTypes from "../lib/policyTypes.js";
import type * as lib_queryAgent from "../lib/queryAgent.js";
import type * as lib_resend from "../lib/resend.js";
import type * as lib_sdkCallbacks from "../lib/sdkCallbacks.js";
import type * as lib_security from "../lib/security.js";
import type * as lib_threadAccess from "../lib/threadAccess.js";
import type * as migrations from "../migrations.js";
import type * as migrations_cleanOrphanAuth from "../migrations/cleanOrphanAuth.js";
import type * as migrations_migrateOnboarding from "../migrations/migrateOnboarding.js";
import type * as migrations_migrateToThreads from "../migrations/migrateToThreads.js";
import type * as migrations_stripInvitationLegacyFields from "../migrations/stripInvitationLegacyFields.js";
import type * as modelConfig from "../modelConfig.js";
import type * as modelSettings from "../modelSettings.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as notifications from "../notifications.js";
import type * as oauth from "../oauth.js";
import type * as orgMemory from "../orgMemory.js";
import type * as organizations from "../organizations.js";
import type * as orgs from "../orgs.js";
import type * as pendingEmails from "../pendingEmails.js";
import type * as policies from "../policies.js";
import type * as policyAuditLog from "../policyAuditLog.js";
import type * as policyChanges from "../policyChanges.js";
import type * as policyFiles from "../policyFiles.js";
import type * as presence from "../presence.js";
import type * as rateLimits from "../rateLimits.js";
import type * as seed from "../seed.js";
import type * as sourceSpans from "../sourceSpans.js";
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
  "actions/detectDuplicatePolicies": typeof actions_detectDuplicatePolicies;
  "actions/extractCompanyInfo": typeof actions_extractCompanyInfo;
  "actions/extractFromUpload": typeof actions_extractFromUpload;
  "actions/extractSupplementary": typeof actions_extractSupplementary;
  "actions/generateCoi": typeof actions_generateCoi;
  "actions/generateEmailBody": typeof actions_generateEmailBody;
  "actions/handleInboundEmail": typeof actions_handleInboundEmail;
  "actions/handleInboundImessage": typeof actions_handleInboundImessage;
  "actions/mcpChat": typeof actions_mcpChat;
  "actions/policyChangeRequests": typeof actions_policyChangeRequests;
  "actions/policyExtraction": typeof actions_policyExtraction;
  "actions/processThreadChat": typeof actions_processThreadChat;
  "actions/processWebChat": typeof actions_processWebChat;
  "actions/reExtractFromFile": typeof actions_reExtractFromFile;
  "actions/rechunkPolicy": typeof actions_rechunkPolicy;
  "actions/reconcilePolicy": typeof actions_reconcilePolicy;
  "actions/retryExtraction": typeof actions_retryExtraction;
  "actions/sendIntroImessage": typeof actions_sendIntroImessage;
  "actions/sendNotificationEmail": typeof actions_sendNotificationEmail;
  "actions/sendPendingEmail": typeof actions_sendPendingEmail;
  "actions/threadTitle": typeof actions_threadTitle;
  "actions/updateDocumentChunk": typeof actions_updateDocumentChunk;
  agentConversations: typeof agentConversations;
  apiAuditLog: typeof apiAuditLog;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  brokerActivity: typeof brokerActivity;
  certificates: typeof certificates;
  clientInvitations: typeof clientInvitations;
  clientInvitationsTest: typeof clientInvitationsTest;
  clients: typeof clients;
  connectedOrgs: typeof connectedOrgs;
  conversationTurns: typeof conversationTurns;
  crons: typeof crons;
  devClear: typeof devClear;
  documentChunks: typeof documentChunks;
  http: typeof http;
  imessageInboundEvents: typeof imessageInboundEvents;
  "lib/access": typeof lib_access;
  "lib/accessTests": typeof lib_accessTests;
  "lib/actionFailures": typeof lib_actionFailures;
  "lib/agentEmailTemplate": typeof lib_agentEmailTemplate;
  "lib/agentPrompts": typeof lib_agentPrompts;
  "lib/ai": typeof lib_ai;
  "lib/aiClassifier": typeof lib_aiClassifier;
  "lib/aiUtils": typeof lib_aiUtils;
  "lib/apiAuth": typeof lib_apiAuth;
  "lib/apiDto": typeof lib_apiDto;
  "lib/apiError": typeof lib_apiError;
  "lib/auth": typeof lib_auth;
  "lib/branding": typeof lib_branding;
  "lib/brokerActivity": typeof lib_brokerActivity;
  "lib/chatTools": typeof lib_chatTools;
  "lib/coiGenerator": typeof lib_coiGenerator;
  "lib/convexDocumentStore": typeof lib_convexDocumentStore;
  "lib/convexMemoryStore": typeof lib_convexMemoryStore;
  "lib/convexSourceRetriever": typeof lib_convexSourceRetriever;
  "lib/documentMapping": typeof lib_documentMapping;
  "lib/emailPolicySources": typeof lib_emailPolicySources;
  "lib/emailSubagent": typeof lib_emailSubagent;
  "lib/emailTemplate": typeof lib_emailTemplate;
  "lib/extraction": typeof lib_extraction;
  "lib/imessageConfig": typeof lib_imessageConfig;
  "lib/industries": typeof lib_industries;
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/mergePdfs": typeof lib_mergePdfs;
  "lib/modelCatalog": typeof lib_modelCatalog;
  "lib/models": typeof lib_models;
  "lib/notificationEmailTemplate": typeof lib_notificationEmailTemplate;
  "lib/notificationTypes": typeof lib_notificationTypes;
  "lib/notify": typeof lib_notify;
  "lib/orgAuth": typeof lib_orgAuth;
  "lib/orgMemoryContext": typeof lib_orgMemoryContext;
  "lib/orgRelationships": typeof lib_orgRelationships;
  "lib/pdfFiller": typeof lib_pdfFiller;
  "lib/pdfSourceSpans": typeof lib_pdfSourceSpans;
  "lib/pipelineMutations": typeof lib_pipelineMutations;
  "lib/policyLookup": typeof lib_policyLookup;
  "lib/policyTypes": typeof lib_policyTypes;
  "lib/queryAgent": typeof lib_queryAgent;
  "lib/resend": typeof lib_resend;
  "lib/sdkCallbacks": typeof lib_sdkCallbacks;
  "lib/security": typeof lib_security;
  "lib/threadAccess": typeof lib_threadAccess;
  migrations: typeof migrations;
  "migrations/cleanOrphanAuth": typeof migrations_cleanOrphanAuth;
  "migrations/migrateOnboarding": typeof migrations_migrateOnboarding;
  "migrations/migrateToThreads": typeof migrations_migrateToThreads;
  "migrations/stripInvitationLegacyFields": typeof migrations_stripInvitationLegacyFields;
  modelConfig: typeof modelConfig;
  modelSettings: typeof modelSettings;
  notificationPreferences: typeof notificationPreferences;
  notifications: typeof notifications;
  oauth: typeof oauth;
  orgMemory: typeof orgMemory;
  organizations: typeof organizations;
  orgs: typeof orgs;
  pendingEmails: typeof pendingEmails;
  policies: typeof policies;
  policyAuditLog: typeof policyAuditLog;
  policyChanges: typeof policyChanges;
  policyFiles: typeof policyFiles;
  presence: typeof presence;
  rateLimits: typeof rateLimits;
  seed: typeof seed;
  sourceSpans: typeof sourceSpans;
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
