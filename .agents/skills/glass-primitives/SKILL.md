---
name: glass-primitives
description: "Use before adding or changing Glass shared primitives: UI components, feature flags, model routes, extraction helpers, workflows, agent tools, auth helpers, notification channels, or cross-cutting backend libraries."
---

# Glass Primitives

Use this skill before adding a shared abstraction or when a task risks duplicating an existing owner. The canonical catalog is in `AGENTS.md` under `Primitive Catalog And Reuse Rules`; keep this skill and that section aligned.

## Rule

Search before creating:

```bash
rg "<concept|route|component|table|helper>" AGENTS.md components convex lib hooks app extraction-worker imessage-worker mcp-server
```

Prefer extending the existing primitive when the meaning matches. Add a new primitive only when reusing the old one would make the API misleading. If a change creates, deletes, renames, or materially changes a primitive, update both `AGENTS.md` and this skill in the same PR.

## Catalog

- App shell and navigation: `components/app-shell.tsx`, `components/app-sidebar/*`, `components/app-sidebar/nav-config.tsx`, and `lib/settings-sections.ts`. Settings section identity and derived settings-section variants live in `lib/settings-sections.ts`.
- Operational UI: `components/ui/operational-panel.tsx`, `components/ui/operational-toast.tsx`, `components/ui/message-meta-tag.tsx`, `components/ui/pill-button.tsx`, `components/ui/select.tsx`, `components/ui/dropdown-menu.tsx`, `components/ui/searchable-select.tsx`, `components/settings/settings-switch.tsx`, and `components/settings/feature-flag-toggle-row.tsx`.
- Branding: rendered app/org marks live in `components/ui/brand-icon.tsx`, `components/ui/org-brand-icon.tsx`, and `components/ui/logo-icon.tsx`; browser theme tokens and color utilities live in `lib/branding.ts`; Next.js server-only viewer metadata lives in `lib/viewer-branding.ts`; Convex-safe branding context and white-label gates live in `convex/lib/branding.ts`; Convex org-logo URL attachment lives in `convex/lib/orgBranding.ts`; shared email shells live in `convex/lib/emailTemplate.ts`; notification-email composition lives in `convex/lib/notificationEmailTemplate.ts`.
- Feature flags: `convex/lib/featureFlags.ts`, `organizations.featureFlags`, `orgs.setFeatureFlag`, `operator.setClientFeatureFlag`, `isFeatureEnabled`, and `/settings?section=beta`.
- Local-first sync and current org: `lib/sync/use-cached-query.ts`, `lib/sync/glass-cached-queries.ts`, `lib/sync/operator-cached-queries.ts`, `lib/sync/use-local-first-auto-save.ts`, `hooks/use-current-org.tsx` for the canonical lightweight viewer-org `useCurrentOrg`, and `lib/hooks/use-active-org-context.ts` for URL-aware selected-org surfaces.
- Auth/access: `convex/lib/access.ts`, `convex/lib/operatorIdentity.ts`, `convex/lib/apiAuth.ts`, `convex/lib/mcpAuth.ts`, and `convex/lib/threadAccess.ts`.
- Model routing: `extraction-worker/src/modelRoutingPolicy.ts`, `convex/lib/modelCatalog.ts`, `convex/lib/models.ts`, and model/provider UI logo primitives. Normal org-scoped calls use `generateTextForOrg` / `generateObjectForOrg`; public/default calls use `generateTextForPublicTask` / `generateObjectForPublicTask`; streaming and SDK adapters may use lower-level route primitives. Glass language routing, embeddings, extraction-worker routes, and web retrieval are direct-provider-only; do not use Vercel AI Gateway as a fallback.
- Extraction/source evidence: `extraction-worker/`, `convex/actions/policyExtraction.ts`, `convex/lib/extraction.ts`, `convex/lib/pipelineMutations.ts`, `convex/lib/sourceTree.ts`, `convex/lib/policyDocumentStructure.ts`, `convex/lib/extractionPostProcess.ts`, `convex/lib/declarationFacts.ts`, `convex/lib/coverageBreakdown.ts`, `convex/lib/coverageNames.ts`, `convex/lib/coverageScoping.ts`, and `convex/lib/sdkCallbacks.ts`.
- Policies and broker follow-ups: `convex/policies.ts`, `convex/lib/linesOfBusiness.ts`, `convex/lib/policyVersioning.ts`, `convex/lib/policyLookup.ts`, and `convex/lib/policyTypes.ts`; policy-update requests use the generic broker-email path instead of policy-change case helpers.
- Certificates: `convex/certificates.ts`, `convex/certificateLifecycle.ts`, `convex/lib/workflows/certificateRequest.ts`, `convex/lib/certificateRequestGate.ts`, `convex/lib/certificateHolderPopulation.ts`, `convex/lib/certificateIdentity.ts`, `convex/lib/certificateHolderResolution.ts`, `convex/lib/certificateDescription.ts`, and `convex/lib/coiGenerator.ts`.
- Compliance and Connect: `convex/actions/complianceRequirements.ts`, `convex/lib/requirementSemantics.ts`, `convex/lib/complianceAgent.ts`, `convex/lib/vendorComplianceTools.ts`, `convex/connectedOrgs.ts`, and the `connect_features` flag.
- Agent/chat controls: `convex/lib/agentPrompts.ts`, `convex/lib/agentScope.ts`, `convex/lib/chatTools.ts`, `convex/lib/agentToolExecutors.ts`, `convex/lib/agentToolAudit.ts`, `convex/lib/agentMessageHistory.ts`, `convex/lib/taskControlIntent.ts`, `convex/lib/taskControlDecision.ts`, `convex/lib/webChatDeterministicControls.ts`, and `convex/lib/textChannelControls.ts`.
- Email, notifications, and iMessage: `convex/lib/resend.ts`, `convex/lib/emailDelivery.ts`, `convex/emailDeliveryAttempts.ts`, `convex/lib/emailTemplate.ts`, `convex/lib/notificationEmailTemplate.ts`, `convex/lib/emailSubagent.ts`, `convex/lib/emailIntentGuards.ts`, `convex/lib/emailWorkflow.ts`, `convex/lib/emailDraftService.ts`, `convex/lib/emailDraftArtifacts.ts`, `convex/lib/emailPayloadFields.ts`, `convex/lib/emailCommandExecutor.ts`, `convex/lib/emailIdentity.ts`, `pendingEmails.sendBlockedReason` for draft send blocks, `convex/lib/notificationTypes.ts`, `convex/lib/notify.ts`, `convex/lib/imessage*.ts`, and `imessage-worker/`.
- Public APIs and integrations: `convex/lib/apiAuth.ts`, `convex/lib/apiDto.ts`, `convex/lib/apiError.ts`, and `mcp-server/`.
- Workers/deploy: `extraction-worker/`, `imessage-worker/`, `mailbox-scan-worker/`, `config/deployments.json`, Railway health/env docs in `AGENTS.md`, and `npm run check:cl-sdk-version`.

## Known Cleanup Targets

When the user asks for primitive cleanup, start with branding/email shell ownership, raw settings switches outside `SettingsSwitch`, and any settings/nav section duplication before broader refactors.
