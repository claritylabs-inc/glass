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
import type * as actions_complianceRequirements from "../actions/complianceRequirements.js";
import type * as actions_connectedEmail from "../actions/connectedEmail.js";
import type * as actions_createOutboundImessageGroup from "../actions/createOutboundImessageGroup.js";
import type * as actions_detectDuplicatePolicies from "../actions/detectDuplicatePolicies.js";
import type * as actions_emailDrafts from "../actions/emailDrafts.js";
import type * as actions_extractCompanyInfo from "../actions/extractCompanyInfo.js";
import type * as actions_extractFromUpload from "../actions/extractFromUpload.js";
import type * as actions_extractSupplementary from "../actions/extractSupplementary.js";
import type * as actions_generateCoi from "../actions/generateCoi.js";
import type * as actions_generateEmailBody from "../actions/generateEmailBody.js";
import type * as actions_handleInboundEmail from "../actions/handleInboundEmail.js";
import type * as actions_handleInboundImessage from "../actions/handleInboundImessage.js";
import type * as actions_mailboxCoordinator from "../actions/mailboxCoordinator.js";
import type * as actions_mcpChat from "../actions/mcpChat.js";
import type * as actions_mirrorWebChatToImessage from "../actions/mirrorWebChatToImessage.js";
import type * as actions_policyChangeRequests from "../actions/policyChangeRequests.js";
import type * as actions_policyExtraction from "../actions/policyExtraction.js";
import type * as actions_processThreadChat from "../actions/processThreadChat.js";
import type * as actions_reExtractFromFile from "../actions/reExtractFromFile.js";
import type * as actions_rechunkPolicy from "../actions/rechunkPolicy.js";
import type * as actions_reconcilePolicy from "../actions/reconcilePolicy.js";
import type * as actions_renderEmailPreview from "../actions/renderEmailPreview.js";
import type * as actions_retryExtraction from "../actions/retryExtraction.js";
import type * as actions_sendIntroImessage from "../actions/sendIntroImessage.js";
import type * as actions_sendNotificationEmail from "../actions/sendNotificationEmail.js";
import type * as actions_sendNotificationImessage from "../actions/sendNotificationImessage.js";
import type * as actions_sendPendingEmail from "../actions/sendPendingEmail.js";
import type * as actions_threadTitle from "../actions/threadTitle.js";
import type * as actions_updateDocumentChunk from "../actions/updateDocumentChunk.js";
import type * as actions_vendorComplianceMonitor from "../actions/vendorComplianceMonitor.js";
import type * as agentTargets from "../agentTargets.js";
import type * as apiAuditLog from "../apiAuditLog.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as brokerActivity from "../brokerActivity.js";
import type * as certificates from "../certificates.js";
import type * as clientInvitations from "../clientInvitations.js";
import type * as clientInvitationsTest from "../clientInvitationsTest.js";
import type * as clients from "../clients.js";
import type * as compliance from "../compliance.js";
import type * as connectedEmail from "../connectedEmail.js";
import type * as connectedOrgs from "../connectedOrgs.js";
import type * as conversationTurns from "../conversationTurns.js";
import type * as crons from "../crons.js";
import type * as declarationFacts from "../declarationFacts.js";
import type * as devClear from "../devClear.js";
import type * as documentChunks from "../documentChunks.js";
import type * as http from "../http.js";
import type * as imessageChats from "../imessageChats.js";
import type * as imessageInboundEvents from "../imessageInboundEvents.js";
import type * as imessageOutboundGroups from "../imessageOutboundGroups.js";
import type * as imessageOutboundSends from "../imessageOutboundSends.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_accessTests from "../lib/accessTests.js";
import type * as lib_actionFailures from "../lib/actionFailures.js";
import type * as lib_agentEmailTemplate from "../lib/agentEmailTemplate.js";
import type * as lib_agentPrompts from "../lib/agentPrompts.js";
import type * as lib_agentScope from "../lib/agentScope.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_aiClassifier from "../lib/aiClassifier.js";
import type * as lib_aiUtils from "../lib/aiUtils.js";
import type * as lib_apiAuth from "../lib/apiAuth.js";
import type * as lib_apiDto from "../lib/apiDto.js";
import type * as lib_apiError from "../lib/apiError.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_branding from "../lib/branding.js";
import type * as lib_brokerActivity from "../lib/brokerActivity.js";
import type * as lib_brokerIdentity from "../lib/brokerIdentity.js";
import type * as lib_certificateProgramSelection from "../lib/certificateProgramSelection.js";
import type * as lib_chatTools from "../lib/chatTools.js";
import type * as lib_coiAttachmentGuards from "../lib/coiAttachmentGuards.js";
import type * as lib_coiGenerator from "../lib/coiGenerator.js";
import type * as lib_coiTemplateOverlay from "../lib/coiTemplateOverlay.js";
import type * as lib_complianceAgent from "../lib/complianceAgent.js";
import type * as lib_convexDocumentStore from "../lib/convexDocumentStore.js";
import type * as lib_convexMemoryStore from "../lib/convexMemoryStore.js";
import type * as lib_convexSourceRetriever from "../lib/convexSourceRetriever.js";
import type * as lib_coverageScoping from "../lib/coverageScoping.js";
import type * as lib_declarationFacts from "../lib/declarationFacts.js";
import type * as lib_doclingPreprocessor from "../lib/doclingPreprocessor.js";
import type * as lib_documentMapping from "../lib/documentMapping.js";
import type * as lib_domains from "../lib/domains.js";
import type * as lib_emailAddress from "../lib/emailAddress.js";
import type * as lib_emailCancelIntent from "../lib/emailCancelIntent.js";
import type * as lib_emailDraftSummary from "../lib/emailDraftSummary.js";
import type * as lib_emailIntentGuards from "../lib/emailIntentGuards.js";
import type * as lib_emailPolicySources from "../lib/emailPolicySources.js";
import type * as lib_emailSubagent from "../lib/emailSubagent.js";
import type * as lib_emailTemplate from "../lib/emailTemplate.js";
import type * as lib_extraction from "../lib/extraction.js";
import type * as lib_imessageConfig from "../lib/imessageConfig.js";
import type * as lib_imessageGroupResolution from "../lib/imessageGroupResolution.js";
import type * as lib_imessageOutbound from "../lib/imessageOutbound.js";
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
import type * as lib_pceIntake from "../lib/pceIntake.js";
import type * as lib_pdfFiller from "../lib/pdfFiller.js";
import type * as lib_pdfSourceSpans from "../lib/pdfSourceSpans.js";
import type * as lib_pipelineMutations from "../lib/pipelineMutations.js";
import type * as lib_policyLookup from "../lib/policyLookup.js";
import type * as lib_policyPeriodExtraction from "../lib/policyPeriodExtraction.js";
import type * as lib_policyToolResolution from "../lib/policyToolResolution.js";
import type * as lib_policyTypes from "../lib/policyTypes.js";
import type * as lib_queryAgent from "../lib/queryAgent.js";
import type * as lib_resend from "../lib/resend.js";
import type * as lib_sdkCallbacks from "../lib/sdkCallbacks.js";
import type * as lib_security from "../lib/security.js";
import type * as lib_threadAccess from "../lib/threadAccess.js";
import type * as lib_userPhone from "../lib/userPhone.js";
import type * as lib_valueNormalization from "../lib/valueNormalization.js";
import type * as lib_vendorComplianceTools from "../lib/vendorComplianceTools.js";
import type * as modelConfig from "../modelConfig.js";
import type * as modelSettings from "../modelSettings.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as notifications from "../notifications.js";
import type * as oauth from "../oauth.js";
import type * as operatorProvisioning from "../operatorProvisioning.js";
import type * as orgMemory from "../orgMemory.js";
import type * as organizations from "../organizations.js";
import type * as orgs from "../orgs.js";
import type * as partnerPrograms from "../partnerPrograms.js";
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

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/backfillChunks": typeof actions_backfillChunks;
  "actions/complianceRequirements": typeof actions_complianceRequirements;
  "actions/connectedEmail": typeof actions_connectedEmail;
  "actions/createOutboundImessageGroup": typeof actions_createOutboundImessageGroup;
  "actions/detectDuplicatePolicies": typeof actions_detectDuplicatePolicies;
  "actions/emailDrafts": typeof actions_emailDrafts;
  "actions/extractCompanyInfo": typeof actions_extractCompanyInfo;
  "actions/extractFromUpload": typeof actions_extractFromUpload;
  "actions/extractSupplementary": typeof actions_extractSupplementary;
  "actions/generateCoi": typeof actions_generateCoi;
  "actions/generateEmailBody": typeof actions_generateEmailBody;
  "actions/handleInboundEmail": typeof actions_handleInboundEmail;
  "actions/handleInboundImessage": typeof actions_handleInboundImessage;
  "actions/mailboxCoordinator": typeof actions_mailboxCoordinator;
  "actions/mcpChat": typeof actions_mcpChat;
  "actions/mirrorWebChatToImessage": typeof actions_mirrorWebChatToImessage;
  "actions/policyChangeRequests": typeof actions_policyChangeRequests;
  "actions/policyExtraction": typeof actions_policyExtraction;
  "actions/processThreadChat": typeof actions_processThreadChat;
  "actions/reExtractFromFile": typeof actions_reExtractFromFile;
  "actions/rechunkPolicy": typeof actions_rechunkPolicy;
  "actions/reconcilePolicy": typeof actions_reconcilePolicy;
  "actions/renderEmailPreview": typeof actions_renderEmailPreview;
  "actions/retryExtraction": typeof actions_retryExtraction;
  "actions/sendIntroImessage": typeof actions_sendIntroImessage;
  "actions/sendNotificationEmail": typeof actions_sendNotificationEmail;
  "actions/sendNotificationImessage": typeof actions_sendNotificationImessage;
  "actions/sendPendingEmail": typeof actions_sendPendingEmail;
  "actions/threadTitle": typeof actions_threadTitle;
  "actions/updateDocumentChunk": typeof actions_updateDocumentChunk;
  "actions/vendorComplianceMonitor": typeof actions_vendorComplianceMonitor;
  agentTargets: typeof agentTargets;
  apiAuditLog: typeof apiAuditLog;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  brokerActivity: typeof brokerActivity;
  certificates: typeof certificates;
  clientInvitations: typeof clientInvitations;
  clientInvitationsTest: typeof clientInvitationsTest;
  clients: typeof clients;
  compliance: typeof compliance;
  connectedEmail: typeof connectedEmail;
  connectedOrgs: typeof connectedOrgs;
  conversationTurns: typeof conversationTurns;
  crons: typeof crons;
  declarationFacts: typeof declarationFacts;
  devClear: typeof devClear;
  documentChunks: typeof documentChunks;
  http: typeof http;
  imessageChats: typeof imessageChats;
  imessageInboundEvents: typeof imessageInboundEvents;
  imessageOutboundGroups: typeof imessageOutboundGroups;
  imessageOutboundSends: typeof imessageOutboundSends;
  "lib/access": typeof lib_access;
  "lib/accessTests": typeof lib_accessTests;
  "lib/actionFailures": typeof lib_actionFailures;
  "lib/agentEmailTemplate": typeof lib_agentEmailTemplate;
  "lib/agentPrompts": typeof lib_agentPrompts;
  "lib/agentScope": typeof lib_agentScope;
  "lib/ai": typeof lib_ai;
  "lib/aiClassifier": typeof lib_aiClassifier;
  "lib/aiUtils": typeof lib_aiUtils;
  "lib/apiAuth": typeof lib_apiAuth;
  "lib/apiDto": typeof lib_apiDto;
  "lib/apiError": typeof lib_apiError;
  "lib/auth": typeof lib_auth;
  "lib/branding": typeof lib_branding;
  "lib/brokerActivity": typeof lib_brokerActivity;
  "lib/brokerIdentity": typeof lib_brokerIdentity;
  "lib/certificateProgramSelection": typeof lib_certificateProgramSelection;
  "lib/chatTools": typeof lib_chatTools;
  "lib/coiAttachmentGuards": typeof lib_coiAttachmentGuards;
  "lib/coiGenerator": typeof lib_coiGenerator;
  "lib/coiTemplateOverlay": typeof lib_coiTemplateOverlay;
  "lib/complianceAgent": typeof lib_complianceAgent;
  "lib/convexDocumentStore": typeof lib_convexDocumentStore;
  "lib/convexMemoryStore": typeof lib_convexMemoryStore;
  "lib/convexSourceRetriever": typeof lib_convexSourceRetriever;
  "lib/coverageScoping": typeof lib_coverageScoping;
  "lib/declarationFacts": typeof lib_declarationFacts;
  "lib/doclingPreprocessor": typeof lib_doclingPreprocessor;
  "lib/documentMapping": typeof lib_documentMapping;
  "lib/domains": typeof lib_domains;
  "lib/emailAddress": typeof lib_emailAddress;
  "lib/emailCancelIntent": typeof lib_emailCancelIntent;
  "lib/emailDraftSummary": typeof lib_emailDraftSummary;
  "lib/emailIntentGuards": typeof lib_emailIntentGuards;
  "lib/emailPolicySources": typeof lib_emailPolicySources;
  "lib/emailSubagent": typeof lib_emailSubagent;
  "lib/emailTemplate": typeof lib_emailTemplate;
  "lib/extraction": typeof lib_extraction;
  "lib/imessageConfig": typeof lib_imessageConfig;
  "lib/imessageGroupResolution": typeof lib_imessageGroupResolution;
  "lib/imessageOutbound": typeof lib_imessageOutbound;
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
  "lib/pceIntake": typeof lib_pceIntake;
  "lib/pdfFiller": typeof lib_pdfFiller;
  "lib/pdfSourceSpans": typeof lib_pdfSourceSpans;
  "lib/pipelineMutations": typeof lib_pipelineMutations;
  "lib/policyLookup": typeof lib_policyLookup;
  "lib/policyPeriodExtraction": typeof lib_policyPeriodExtraction;
  "lib/policyToolResolution": typeof lib_policyToolResolution;
  "lib/policyTypes": typeof lib_policyTypes;
  "lib/queryAgent": typeof lib_queryAgent;
  "lib/resend": typeof lib_resend;
  "lib/sdkCallbacks": typeof lib_sdkCallbacks;
  "lib/security": typeof lib_security;
  "lib/threadAccess": typeof lib_threadAccess;
  "lib/userPhone": typeof lib_userPhone;
  "lib/valueNormalization": typeof lib_valueNormalization;
  "lib/vendorComplianceTools": typeof lib_vendorComplianceTools;
  modelConfig: typeof modelConfig;
  modelSettings: typeof modelSettings;
  notificationPreferences: typeof notificationPreferences;
  notifications: typeof notifications;
  oauth: typeof oauth;
  operatorProvisioning: typeof operatorProvisioning;
  orgMemory: typeof orgMemory;
  organizations: typeof organizations;
  orgs: typeof orgs;
  partnerPrograms: typeof partnerPrograms;
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
