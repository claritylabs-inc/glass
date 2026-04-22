/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_addFileToPolicy from "../actions/addFileToPolicy.js";
import type * as actions_applicationAuthoring from "../actions/applicationAuthoring.js";
import type * as actions_applicationPrefill from "../actions/applicationPrefill.js";
import type * as actions_backfillChunks from "../actions/backfillChunks.js";
import type * as actions_classifyEmails from "../actions/classifyEmails.js";
import type * as actions_dailyScan from "../actions/dailyScan.js";
import type * as actions_detectDuplicatePolicies from "../actions/detectDuplicatePolicies.js";
import type * as actions_dreamConsolidation from "../actions/dreamConsolidation.js";
import type * as actions_extractApplicationPdf from "../actions/extractApplicationPdf.js";
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
import type * as actions_integrationConnectionActions from "../actions/integrationConnectionActions.js";
import type * as actions_mcpChat from "../actions/mcpChat.js";
import type * as actions_mergeSync from "../actions/mergeSync.js";
import type * as actions_migrateIntelligence from "../actions/migrateIntelligence.js";
import type * as actions_passportExtraction from "../actions/passportExtraction.js";
import type * as actions_proactiveAnalysis from "../actions/proactiveAnalysis.js";
import type * as actions_processThreadChat from "../actions/processThreadChat.js";
import type * as actions_processWebChat from "../actions/processWebChat.js";
import type * as actions_proposePassportFields from "../actions/proposePassportFields.js";
import type * as actions_reExtractFromFile from "../actions/reExtractFromFile.js";
import type * as actions_rechunkPolicy from "../actions/rechunkPolicy.js";
import type * as actions_reconcilePolicy from "../actions/reconcilePolicy.js";
import type * as actions_retryExtraction from "../actions/retryExtraction.js";
import type * as actions_scanGmail from "../actions/scanGmail.js";
import type * as actions_scanInbox from "../actions/scanInbox.js";
import type * as actions_sendNotificationEmail from "../actions/sendNotificationEmail.js";
import type * as actions_sendPendingEmail from "../actions/sendPendingEmail.js";
import type * as actions_triageEmails from "../actions/triageEmails.js";
import type * as actions_updateDocumentChunk from "../actions/updateDocumentChunk.js";
import type * as actions_vectorProjection from "../actions/vectorProjection.js";
import type * as agentConversations from "../agentConversations.js";
import type * as apiAuditLog from "../apiAuditLog.js";
import type * as apiKeys from "../apiKeys.js";
import type * as applicationAnswers from "../applicationAnswers.js";
import type * as applicationGroups from "../applicationGroups.js";
import type * as applicationGroupsMutationsInternal from "../applicationGroupsMutationsInternal.js";
import type * as applicationQuestionFlags from "../applicationQuestionFlags.js";
import type * as applicationQuestionsInternal from "../applicationQuestionsInternal.js";
import type * as applications from "../applications.js";
import type * as applicationsInternal from "../applicationsInternal.js";
import type * as auth from "../auth.js";
import type * as brokerActivity from "../brokerActivity.js";
import type * as businessContext from "../businessContext.js";
import type * as clientInvitations from "../clientInvitations.js";
import type * as clientInvitationsTest from "../clientInvitationsTest.js";
import type * as clientPassport from "../clientPassport.js";
import type * as clients from "../clients.js";
import type * as connections from "../connections.js";
import type * as conversationTurns from "../conversationTurns.js";
import type * as crons from "../crons.js";
import type * as documentChunks from "../documentChunks.js";
import type * as dreamLogs from "../dreamLogs.js";
import type * as emailScanLogs from "../emailScanLogs.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as integrationConnections from "../integrationConnections.js";
import type * as integrationData from "../integrationData.js";
import type * as integrationRequests from "../integrationRequests.js";
import type * as integrationSyncLogs from "../integrationSyncLogs.js";
import type * as integrations from "../integrations.js";
import type * as intelligence from "../intelligence.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_accessTests from "../lib/accessTests.js";
import type * as lib_agentEmailTemplate from "../lib/agentEmailTemplate.js";
import type * as lib_agentPrompts from "../lib/agentPrompts.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_aiClassifier from "../lib/aiClassifier.js";
import type * as lib_aiUtils from "../lib/aiUtils.js";
import type * as lib_apiAuth from "../lib/apiAuth.js";
import type * as lib_apiDto from "../lib/apiDto.js";
import type * as lib_apiError from "../lib/apiError.js";
import type * as lib_applicationCapabilities from "../lib/applicationCapabilities.js";
import type * as lib_applicationConditionals from "../lib/applicationConditionals.js";
import type * as lib_applicationDerivation from "../lib/applicationDerivation.js";
import type * as lib_applicationGrouping from "../lib/applicationGrouping.js";
import type * as lib_applicationPdfExtraction from "../lib/applicationPdfExtraction.js";
import type * as lib_applicationPrefill from "../lib/applicationPrefill.js";
import type * as lib_applicationPrompts from "../lib/applicationPrompts.js";
import type * as lib_applicationTypes from "../lib/applicationTypes.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_branding from "../lib/branding.js";
import type * as lib_brokerActivity from "../lib/brokerActivity.js";
import type * as lib_chatTools from "../lib/chatTools.js";
import type * as lib_coiGenerator from "../lib/coiGenerator.js";
import type * as lib_convexDocumentStore from "../lib/convexDocumentStore.js";
import type * as lib_convexMemoryStore from "../lib/convexMemoryStore.js";
import type * as lib_documentMapping from "../lib/documentMapping.js";
import type * as lib_emailTemplate from "../lib/emailTemplate.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_industries from "../lib/industries.js";
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_mergeClient from "../lib/mergeClient.js";
import type * as lib_models from "../lib/models.js";
import type * as lib_notificationEmailTemplate from "../lib/notificationEmailTemplate.js";
import type * as lib_notificationTypes from "../lib/notificationTypes.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_orgAuth from "../lib/orgAuth.js";
import type * as lib_orgMemoryContext from "../lib/orgMemoryContext.js";
import type * as lib_orgRelationships from "../lib/orgRelationships.js";
import type * as lib_passportCompletion from "../lib/passportCompletion.js";
import type * as lib_passportIntelligence from "../lib/passportIntelligence.js";
import type * as lib_pdfFiller from "../lib/pdfFiller.js";
import type * as lib_policyTypes from "../lib/policyTypes.js";
import type * as lib_queryAgent from "../lib/queryAgent.js";
import type * as lib_resend from "../lib/resend.js";
import type * as lib_sdkCallbacks from "../lib/sdkCallbacks.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_security from "../lib/security.js";
import type * as lib_threadAccess from "../lib/threadAccess.js";
import type * as migrations from "../migrations.js";
import type * as migrations_migrateOnboarding from "../migrations/migrateOnboarding.js";
import type * as migrations_migrateToThreads from "../migrations/migrateToThreads.js";
import type * as modelConfig from "../modelConfig.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as notifications from "../notifications.js";
import type * as oauth from "../oauth.js";
import type * as orgDocuments from "../orgDocuments.js";
import type * as orgMemory from "../orgMemory.js";
import type * as organizations from "../organizations.js";
import type * as orgs from "../orgs.js";
import type * as passportFieldFlags from "../passportFieldFlags.js";
import type * as passportSideTables from "../passportSideTables.js";
import type * as pendingEmails from "../pendingEmails.js";
import type * as policies from "../policies.js";
import type * as policyAuditLog from "../policyAuditLog.js";
import type * as policyFiles from "../policyFiles.js";
import type * as presence from "../presence.js";
import type * as questionIntents from "../questionIntents.js";
import type * as rateLimits from "../rateLimits.js";
import type * as seed from "../seed.js";
import type * as seed_questionIntents from "../seed/questionIntents.js";
import type * as threads from "../threads.js";
import type * as users from "../users.js";
import type * as webChats from "../webChats.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/addFileToPolicy": typeof actions_addFileToPolicy;
  "actions/applicationAuthoring": typeof actions_applicationAuthoring;
  "actions/applicationPrefill": typeof actions_applicationPrefill;
  "actions/backfillChunks": typeof actions_backfillChunks;
  "actions/classifyEmails": typeof actions_classifyEmails;
  "actions/dailyScan": typeof actions_dailyScan;
  "actions/detectDuplicatePolicies": typeof actions_detectDuplicatePolicies;
  "actions/dreamConsolidation": typeof actions_dreamConsolidation;
  "actions/extractApplicationPdf": typeof actions_extractApplicationPdf;
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
  "actions/integrationConnectionActions": typeof actions_integrationConnectionActions;
  "actions/mcpChat": typeof actions_mcpChat;
  "actions/mergeSync": typeof actions_mergeSync;
  "actions/migrateIntelligence": typeof actions_migrateIntelligence;
  "actions/passportExtraction": typeof actions_passportExtraction;
  "actions/proactiveAnalysis": typeof actions_proactiveAnalysis;
  "actions/processThreadChat": typeof actions_processThreadChat;
  "actions/processWebChat": typeof actions_processWebChat;
  "actions/proposePassportFields": typeof actions_proposePassportFields;
  "actions/reExtractFromFile": typeof actions_reExtractFromFile;
  "actions/rechunkPolicy": typeof actions_rechunkPolicy;
  "actions/reconcilePolicy": typeof actions_reconcilePolicy;
  "actions/retryExtraction": typeof actions_retryExtraction;
  "actions/scanGmail": typeof actions_scanGmail;
  "actions/scanInbox": typeof actions_scanInbox;
  "actions/sendNotificationEmail": typeof actions_sendNotificationEmail;
  "actions/sendPendingEmail": typeof actions_sendPendingEmail;
  "actions/triageEmails": typeof actions_triageEmails;
  "actions/updateDocumentChunk": typeof actions_updateDocumentChunk;
  "actions/vectorProjection": typeof actions_vectorProjection;
  agentConversations: typeof agentConversations;
  apiAuditLog: typeof apiAuditLog;
  apiKeys: typeof apiKeys;
  applicationAnswers: typeof applicationAnswers;
  applicationGroups: typeof applicationGroups;
  applicationGroupsMutationsInternal: typeof applicationGroupsMutationsInternal;
  applicationQuestionFlags: typeof applicationQuestionFlags;
  applicationQuestionsInternal: typeof applicationQuestionsInternal;
  applications: typeof applications;
  applicationsInternal: typeof applicationsInternal;
  auth: typeof auth;
  brokerActivity: typeof brokerActivity;
  businessContext: typeof businessContext;
  clientInvitations: typeof clientInvitations;
  clientInvitationsTest: typeof clientInvitationsTest;
  clientPassport: typeof clientPassport;
  clients: typeof clients;
  connections: typeof connections;
  conversationTurns: typeof conversationTurns;
  crons: typeof crons;
  documentChunks: typeof documentChunks;
  dreamLogs: typeof dreamLogs;
  emailScanLogs: typeof emailScanLogs;
  emails: typeof emails;
  http: typeof http;
  integrationConnections: typeof integrationConnections;
  integrationData: typeof integrationData;
  integrationRequests: typeof integrationRequests;
  integrationSyncLogs: typeof integrationSyncLogs;
  integrations: typeof integrations;
  intelligence: typeof intelligence;
  "lib/access": typeof lib_access;
  "lib/accessTests": typeof lib_accessTests;
  "lib/agentEmailTemplate": typeof lib_agentEmailTemplate;
  "lib/agentPrompts": typeof lib_agentPrompts;
  "lib/ai": typeof lib_ai;
  "lib/aiClassifier": typeof lib_aiClassifier;
  "lib/aiUtils": typeof lib_aiUtils;
  "lib/apiAuth": typeof lib_apiAuth;
  "lib/apiDto": typeof lib_apiDto;
  "lib/apiError": typeof lib_apiError;
  "lib/applicationCapabilities": typeof lib_applicationCapabilities;
  "lib/applicationConditionals": typeof lib_applicationConditionals;
  "lib/applicationDerivation": typeof lib_applicationDerivation;
  "lib/applicationGrouping": typeof lib_applicationGrouping;
  "lib/applicationPdfExtraction": typeof lib_applicationPdfExtraction;
  "lib/applicationPrefill": typeof lib_applicationPrefill;
  "lib/applicationPrompts": typeof lib_applicationPrompts;
  "lib/applicationTypes": typeof lib_applicationTypes;
  "lib/auth": typeof lib_auth;
  "lib/branding": typeof lib_branding;
  "lib/brokerActivity": typeof lib_brokerActivity;
  "lib/chatTools": typeof lib_chatTools;
  "lib/coiGenerator": typeof lib_coiGenerator;
  "lib/convexDocumentStore": typeof lib_convexDocumentStore;
  "lib/convexMemoryStore": typeof lib_convexMemoryStore;
  "lib/documentMapping": typeof lib_documentMapping;
  "lib/emailTemplate": typeof lib_emailTemplate;
  "lib/extraction": typeof lib_extraction;
  "lib/industries": typeof lib_industries;
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/mergeClient": typeof lib_mergeClient;
  "lib/models": typeof lib_models;
  "lib/notificationEmailTemplate": typeof lib_notificationEmailTemplate;
  "lib/notificationTypes": typeof lib_notificationTypes;
  "lib/notify": typeof lib_notify;
  "lib/orgAuth": typeof lib_orgAuth;
  "lib/orgMemoryContext": typeof lib_orgMemoryContext;
  "lib/orgRelationships": typeof lib_orgRelationships;
  "lib/passportCompletion": typeof lib_passportCompletion;
  "lib/passportIntelligence": typeof lib_passportIntelligence;
  "lib/pdfFiller": typeof lib_pdfFiller;
  "lib/policyTypes": typeof lib_policyTypes;
  "lib/queryAgent": typeof lib_queryAgent;
  "lib/resend": typeof lib_resend;
  "lib/sdkCallbacks": typeof lib_sdkCallbacks;
  "lib/secrets": typeof lib_secrets;
  "lib/security": typeof lib_security;
  "lib/threadAccess": typeof lib_threadAccess;
  migrations: typeof migrations;
  "migrations/migrateOnboarding": typeof migrations_migrateOnboarding;
  "migrations/migrateToThreads": typeof migrations_migrateToThreads;
  modelConfig: typeof modelConfig;
  notificationPreferences: typeof notificationPreferences;
  notifications: typeof notifications;
  oauth: typeof oauth;
  orgDocuments: typeof orgDocuments;
  orgMemory: typeof orgMemory;
  organizations: typeof organizations;
  orgs: typeof orgs;
  passportFieldFlags: typeof passportFieldFlags;
  passportSideTables: typeof passportSideTables;
  pendingEmails: typeof pendingEmails;
  policies: typeof policies;
  policyAuditLog: typeof policyAuditLog;
  policyFiles: typeof policyFiles;
  presence: typeof presence;
  questionIntents: typeof questionIntents;
  rateLimits: typeof rateLimits;
  seed: typeof seed;
  "seed/questionIntents": typeof seed_questionIntents;
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
