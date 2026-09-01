# Agent and MCP tool inventory

This reference lists the tools that Spot exposes to its operator agent, tenant-facing conversational agent, internal agent subagents, and OAuth MCP clients. It describes the current executable catalogs; it does not include deterministic controls, ordinary Convex functions, REST routes, or browser actions that are not model-callable or MCP-callable tools.

## Source owners and maintenance

- Operator-agent tools are defined only in `convex/lib/operatorAgentToolRegistry.ts`. `convex/lib/operatorMcpToolCatalog.ts` projects that registry into operator MCP and adds operator-run lifecycle tools.
- Shared tenant conversational tools are defined in `convex/lib/chatTools.ts` and executed by `convex/lib/agentToolExecutors.ts` plus `convex/lib/vendorComplianceTools.ts`.
- Channel-specific tenant tools are assembled in `convex/actions/processThreadChat.ts`, `convex/actions/handleInboundEmail.ts`, `convex/actions/handleInboundImessage.ts`, and `convex/actions/mcpChat.ts`.
- Internal mailbox- and email-subagent tools live in `convex/actions/mailboxCoordinator.ts` and `convex/lib/emailSubagent.ts`.
- Tenant OAuth MCP tools and their read/write, open-world, destructive, and idempotency metadata are defined together in the typed `MCP_TOOLS` catalog in `convex/http.ts`.

When any source above adds, removes, renames, or materially changes a tool, update this inventory in the same change. Availability, capability, effect, required role, confirmation policy, execution boundary, and MCP access changes count as material.

## Operator agent registry

The operator registry currently contains 48 tools. Every non-read tool requires an exact, fingerprint-bound confirmation. `mutation` and `action` identify the Convex execution boundary, not whether the operation writes data.

| Tool                                 | Purpose                                                                               | Capability                      | Effect           | Role     | Confirmation | Execution |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------- | ---------------- | -------- | ------------ | --------- |
| `search_organizations`               | Search customer and broker organizations and resolve exact IDs.                       | `operator.organizations.read`   | read             | operator | none         | mutation  |
| `get_organization`                   | Read an organization's profile, lifecycle, flags, membership count, and policy count. | `operator.organizations.read`   | read             | operator | none         | mutation  |
| `get_operator_overview`              | Read compact platform, policy, extraction, and operator-run counts.                   | `operator.platform.read`        | read             | operator | none         | mutation  |
| `list_policies`                      | List or search policies for one organization.                                         | `operator.policies.read`        | read             | operator | none         | mutation  |
| `lookup_policy`                      | Retrieve rich current policy summaries for one client.                                | `operator.policies.read`        | read             | operator | none         | action    |
| `compare_coverages`                  | Compare two policies' coverages, limits, deductibles, and premium.                    | `operator.policies.read`        | read             | operator | none         | action    |
| `lookup_policy_section`              | Search a final policy's source-native hierarchy and PDF evidence.                     | `operator.policies.read`        | read             | operator | none         | action    |
| `attach_policy_document`             | Attach a final policy's original PDF to the operator response.                        | `operator.policies.read`        | read             | operator | none         | action    |
| `confirm_policy_fact`                | Confirm a source-backed policy fact and optionally patch allowed fields.              | `operator.policies.write`       | reversible write | operator | exact        | action    |
| `lookup_compliance_requirements`     | Retrieve saved insurance requirements for one client.                                 | `operator.compliance.read`      | read             | operator | none         | action    |
| `search_thread_history`              | Search older messages in the current operator conversation.                           | `operator.threads.read`         | read             | operator | none         | action    |
| `read_thread_attachment`             | Reopen an attachment returned by operator thread-history search.                      | `operator.threads.read`         | read             | operator | none         | action    |
| `list_client_files`                  | List a client's files, provenance, visibility, and policy links.                      | `operator.client_files.read`    | read             | operator | none         | mutation  |
| `read_client_file`                   | Read bounded content from a client file, including private files.                     | `operator.client_files.read`    | read             | operator | none         | action    |
| `attach_client_file`                 | Attach a client file to the operator response, including private files.               | `operator.client_files.read`    | read             | operator | none         | action    |
| `lookup_client_memory`               | Retrieve stable company-context memory for one client.                                | `operator.memory.read`          | read             | operator | none         | mutation  |
| `create_client_memory`               | Create a stable company-context memory fact for one client.                           | `operator.memory.write`         | reversible write | operator | exact        | mutation  |
| `update_client_memory`               | Update one exact company-context memory fact.                                         | `operator.memory.write`         | reversible write | operator | exact        | mutation  |
| `delete_client_memory`               | Permanently delete one exact company-context memory fact.                             | `operator.memory.write`         | destructive      | operator | exact        | mutation  |
| `lookup_procurement_memory`          | Retrieve durable procurement learnings for one client.                                | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `create_procurement_memory`          | Create a client-scoped procurement learning with provenance.                          | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_memory`          | Update one exact procurement learning and its provenance links.                       | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `delete_procurement_memory`          | Permanently delete one exact procurement learning.                                    | `operator.procurement.write`    | destructive      | operator | exact        | mutation  |
| `list_procurement_requests`          | List new-policy procurement requests for one client.                                  | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `get_procurement_request`            | Read one procurement request and its broker, file, policy, and email state.           | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `get_procurement_forwarding_address` | Read the unique email forwarding address for one procurement request.                 | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `list_procurement_email_threads`     | List imported forwarding-email threads for a procurement request.                     | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `get_procurement_email_thread`       | Read one imported procurement email thread and bounded message content.               | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `get_policy_status`                  | Read one policy's extraction, source-tree, reconciliation, and archive state.         | `operator.policies.read`        | read             | operator | none         | mutation  |
| `lookup_address`                     | Validate and standardize a postal address through Mapbox.                             | `operator.addresses.read`       | read             | operator | none         | action    |
| `list_extraction_issues`             | List bounded extraction failures, paused runs, or active queue work.                  | `operator.extractions.read`     | read             | operator | none         | mutation  |
| `get_routing_status`                 | Read recent model-routing outcomes, fallbacks, errors, and route freshness.           | `operator.routing.read`         | read             | operator | none         | mutation  |
| `get_channel_health`                 | Read bounded Slack and connected-email health without secrets or message content.     | `operator.channels.read`        | read             | operator | none         | mutation  |
| `retry_failed_policy_extraction`     | Queue a fresh full extraction for one failed or idle policy.                          | `operator.extractions.write`    | reversible write | operator | exact        | mutation  |
| `generate_coi`                       | Generate certificate PDFs from a policy or requirements source.                       | `operator.certificates.write`   | reversible write | operator | exact        | action    |
| `add_client_file`                    | File an operator-thread attachment in a client's file library.                        | `operator.client_files.write`   | reversible write | operator | exact        | mutation  |
| `update_client_file`                 | Rename a client file or change its visibility or policy association.                  | `operator.client_files.write`   | reversible write | operator | exact        | mutation  |
| `create_procurement_request`         | Create a new-policy procurement request and forwarding address.                       | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_request`         | Update a procurement request's supplied fields and policy links.                      | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `create_procurement_broker_outreach` | Add a contacted broker and its application or quote state.                            | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_broker_outreach` | Update a broker outreach record, workflow status, application, or quote.              | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `create_procurement_file_item`       | Track a procurement requirement, application, quote, or other file.                   | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_file_item`       | Update a procurement file item and its optional links.                                | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_email_thread`    | Correct an imported procurement email's category or request assignment.               | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_organization_profile`        | Update selected editable organization profile fields.                                 | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `set_organization_status`            | Set an organization's internal lifecycle to onboarding or live.                       | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `set_client_feature_flag`            | Enable or disable a supported client feature flag.                                    | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `clear_all_agent_memory`             | Schedule a global purge of organization and raw conversation memory.                  | `operator.platform.destructive` | destructive      | owner    | exact        | mutation  |

### Operator MCP projection

Operator MCP exposes registered read tools to read-scoped operator tokens, registered write tools only to write-scoped tokens, and owner-only tools only to owners. It adds these lifecycle tools outside the operator-agent registry:

| Tool                      | Purpose                                                                            | Availability        |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------- |
| `run_operator_task`       | Start or continue a durable multi-step operator task, optionally with attachments. | write scope         |
| `get_operator_run`        | Read an operator run, checkpoint, response, and pending confirmation.              | read or write scope |
| `cancel_operator_run`     | Request cancellation of a queued or active operator run.                           | write scope         |
| `confirm_operator_action` | Approve or reject one exact pending operator action.                               | write scope         |

## Client conversational agent

There is no single client registry equivalent to `OPERATOR_AGENT_TOOL_REGISTRY`. The client agent receives a shared executable tool set and channel-specific additions. In the tables below, **MCP chat** means the model loop behind the tenant `ask_spot`/`ask_glass` MCP tools, not the full tenant MCP catalog documented later.

### Shared tools

“All channels” means web, Slack, inbound email, iMessage, and MCP chat. Runtime authorization and readable/writable organization scope still apply.

| Tool                             | Purpose                                                                            | Availability or condition                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `search_thread_history`          | Search older messages in the current conversation.                                 | All channels; requires a thread.                                                |
| `read_thread_attachment`         | Reopen an older attachment identified by thread-history search.                    | All channels; requires a thread.                                                |
| `lookup_client_files`            | List or search readable client dropbox files.                                      | All channels; returns only explicitly client-visible files in readable scope.   |
| `read_client_file`               | Read bounded content from one readable client dropbox file.                        | All channels; the file must be explicitly client-visible.                       |
| `attach_client_file`             | Attach one readable client dropbox file to the response.                           | All channels; the file must be explicitly client-visible.                       |
| `lookup_address`                 | Validate and standardize a user-supplied postal address.                           | All channels; Mapbox must be configured.                                        |
| `lookup_policy`                  | Retrieve fresh policy summaries by IDs, text, LOB, carrier, or expiry window.      | All channels.                                                                   |
| `present_policy_card`            | Select a current-turn resolved policy for rich-card presentation.                  | Web, Slack, and iMessage only.                                                  |
| `lookup_company_context`         | Retrieve durable company-profile facts and preferences, never policy facts.        | All channels.                                                                   |
| `compare_coverages`              | Compare two readable policies side by side.                                        | All channels.                                                                   |
| `lookup_compliance_requirements` | Retrieve saved insurance requirements by topic and scope.                          | All channels.                                                                   |
| `import_requirement_attachments` | Persist and extract server-authorized requirement files from the current message.  | Web, Slack, email, and iMessage only, and only when eligible files are present. |
| `lookup_connected_vendors`       | List connected vendors and compliance status.                                      | All channels.                                                                   |
| `lookup_vendor_policies`         | List policies for a connected vendor.                                              | All channels.                                                                   |
| `lookup_vendor_compliance`       | Retrieve requirement-by-requirement vendor compliance.                             | All channels.                                                                   |
| `lookup_policy_section`          | Search source-native policy hierarchy and exact PDF evidence.                      | All channels; final policies only.                                              |
| `save_note`                      | Save an explicit stable company fact to organization memory.                       | All channels; write permission required.                                        |
| `attach_policy_document`         | Attach the original full policy PDF to the response.                               | All channels; final readable policy and stored PDF required.                    |
| `confirm_policy_fact`            | Confirm a source-backed policy fact and optionally patch allowed top-level fields. | All channels; final writable policy and exact source spans required.            |
| `generate_coi`                   | Generate or reuse certificates from a policy or requirements source.               | All channels; write permission and final supporting policies required.          |

### Channel-specific root tools

| Tool                                             | Purpose                                                                             | Root-agent availability or condition                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `choose_slack_reaction`                          | Choose the temporary processing reaction on a Slack message.                        | Slack only; forced as the first model step and excluded from visible work traces.                                                                        |
| `request_human_service`                          | Pause a Slack AI thread and request operator help.                                  | Slack only, when a Slack actor was resolved.                                                                                                             |
| `create_imessage_group_chat`                     | Create a confirmed outbound iMessage group.                                         | Web; iMessage for a linked sender; direct internal email; MCP chat.                                                                                      |
| `coordinate_mailbox_task`                        | Delegate a multi-step connected-mailbox workflow.                                   | Web and Slack; direct internal email; linked-user iMessage; MCP chat.                                                                                    |
| `web_research`                                   | Retrieve public web facts through the configured provider.                          | Web and Slack; direct internal email; linked-user iMessage; MCP chat.                                                                                    |
| `render_email_preview`                           | Render a durable email draft as PNG or PDF.                                         | Web and Slack only.                                                                                                                                      |
| `email_expert`                                   | Delegate validated email drafting, attachment preparation, and delivery.            | Web/Slack with a send-capable identity; direct internal email; linked-user iMessage with a send-capable identity. MCP uses explicit draft tools instead. |
| `search_connected_email`                         | Search connected IMAP accounts.                                                     | Direct internal email and MCP chat; other channels use the mailbox coordinator.                                                                          |
| `read_connected_email`                           | Read one connected-mailbox message.                                                 | Direct internal email and MCP chat; other channels use the mailbox coordinator.                                                                          |
| `read_connected_email_attachment`                | Read a supported connected-email attachment.                                        | Direct internal email and MCP chat; other channels use the mailbox coordinator.                                                                          |
| `import_connected_email_policy_attachments`      | Import policy PDFs from a connected email.                                          | Direct internal email and MCP chat; other channels use the mailbox coordinator.                                                                          |
| `import_connected_email_requirement_attachments` | Import requirement content from a connected email.                                  | Direct internal email and MCP chat; other channels use the mailbox coordinator.                                                                          |
| `send_connected_vendor_invite`                   | Send a user-authorized connected-vendor invitation.                                 | Direct internal email and MCP chat; other channels use the mailbox coordinator.                                                                          |
| `extract_policy_attachment`                      | Start extraction for one policy represented by one or more inbound PDF attachments. | Inbound email only.                                                                                                                                      |

`sendEmail` in `convex/lib/chatTools.ts` is a schema definition with no registered executor and is not currently callable as `send_email` on any client-agent surface.

For tenant MCP chat, the OAuth token's write scope filters the actual nested executable catalog. Read-only `ask_spot`/`ask_glass` calls exclude `save_note`, `confirm_policy_fact`, `generate_coi`, iMessage creation, connected-email imports, and vendor invitations. A read-only mailbox coordinator receives only search, message-read, and attachment-read tools; it cannot import, save to a thread, or invite a vendor.

### Internal client-agent subagents

The root agent sees `coordinate_mailbox_task` and `email_expert`; the delegated models receive these narrower tool sets.

Mailbox coordinator:

| Tool                                             | Purpose                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `search_connected_email`                         | Search selected or accessible mailboxes.                            |
| `read_connected_email`                           | Read a matching message.                                            |
| `read_connected_email_attachment`                | Read a supported attachment.                                        |
| `import_connected_email_policy_attachments`      | Import policy PDFs.                                                 |
| `import_connected_email_requirement_attachments` | Import requirements from attachments or email body.                 |
| `save_connected_email_attachments_to_thread`     | Save reusable message attachments into the parent thread.           |
| `save_connected_email_message_to_thread`         | Export the message itself into the parent thread as an `.eml` file. |
| `send_connected_vendor_invite`                   | Send an explicitly requested vendor invitation.                     |

When invoked from read-only tenant MCP chat, only the first three read tools in this table are registered.

Email expert:

| Tool                      | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `attach_original_policy`  | Prepare an original policy PDF attachment.                 |
| `attach_uploaded_file`    | Prepare a file already available in the conversation.      |
| `generate_coi_attachment` | Generate and prepare one or more certificate attachments.  |
| `send_or_draft_email`     | Finalize exactly one safe draft, queued send, or delivery. |

## Tenant OAuth MCP catalog

The tenant MCP catalog is separate from the model-callable tools above. It currently contains 38 tools. “Write” means the catalog requires OAuth write scope; runtime organization, role, and resource authorization still apply. Access annotations and the pre-dispatch scope check are derived from the same typed catalog entry, so adding a write tool requires declaring `effect: "write"` in that entry.

| Tool                             | Purpose                                                                    | MCP access                                                                         |
| -------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `list_policies`                  | List policies with optional carrier, year, or LOB filters.                 | read                                                                               |
| `get_policy`                     | Get full details for one policy.                                           | read                                                                               |
| `get_policy_pdf`                 | Get a temporary URL for the original policy PDF.                           | read                                                                               |
| `search_policies`                | Search carrier, policy number, insured, summary, and LOB text.             | read                                                                               |
| `get_policy_stats`               | Get policy totals and type, carrier, and year breakdowns.                  | read                                                                               |
| `list_policy_certificates`       | List generated certificates and lifecycle metadata for a policy.           | read                                                                               |
| `list_certificate_holders`       | List or search the certificate-holder registry.                            | read                                                                               |
| `list_policy_versions`           | List policy document-event versions.                                       | read                                                                               |
| `list_certificate_versions`      | List certificate issue and reissue versions.                               | read                                                                               |
| `list_certificate_review_jobs`   | List certificate renewal, endorsement, and manual-review jobs.             | read                                                                               |
| `generate_policy_certificate`    | Generate certificates in policy or requirements mode.                      | write                                                                              |
| `list_threads`                   | List recent tenant conversation threads.                                   | read                                                                               |
| `get_thread_messages`            | Get all messages in one accessible thread.                                 | read                                                                               |
| `get_org_info`                   | Get the current organization's profile and broker details.                 | read                                                                               |
| `ask_glass`                      | Legacy alias for `ask_spot`.                                               | read; nested tools are read-only unless the token also has write scope; open-world |
| `ask_spot`                       | Run the client conversational agent for portfolio questions and workflows. | read; nested tools are read-only unless the token also has write scope; open-world |
| `list_email_drafts`              | List durable outbound email drafts.                                        | read                                                                               |
| `draft_email`                    | Create a durable outbound email draft.                                     | write                                                                              |
| `update_email_draft`             | Update an existing durable email draft in place.                           | write                                                                              |
| `send_email_draft`               | Send one durable email draft.                                              | write; open-world side effect                                                      |
| `send_email_drafts`              | Send a batch of durable email drafts.                                      | write; open-world side effect                                                      |
| `cancel_email_draft`             | Cancel one durable email draft.                                            | write                                                                              |
| `list_client_files`              | List client-visible shared files in the caller's readable client scope.    | read                                                                               |
| `get_client_file`                | Get metadata and a temporary URL for one client-visible shared file.       | read                                                                               |
| `list_company_memory`            | List stable company-profile facts for the token's exact organization.      | read                                                                               |
| `create_company_memory`          | Create a stable company-profile fact for the token's organization.         | write; current direct organization admin only                                      |
| `update_company_memory`          | Update one exact company-profile fact in the token's organization.         | write; current direct organization admin only                                      |
| `delete_company_memory`          | Permanently delete one exact company-profile fact.                         | write; destructive; current direct organization admin only                         |
| `list_clients`                   | List clients visible to a broker.                                          | read; broker only                                                                  |
| `get_client`                     | Get client profile and policy-count data.                                  | read; broker only                                                                  |
| `list_broker_activity`           | List broker portfolio activity.                                            | read; broker only                                                                  |
| `list_connected_vendors`         | List connected vendors that approved insurance access.                     | read                                                                               |
| `get_connected_vendor`           | Get one connected vendor's profile and policy count.                       | read                                                                               |
| `list_connected_vendor_policies` | List policies for one connected vendor.                                    | read                                                                               |
| `list_my_policies`               | List policies for the caller's client organization.                        | read; client only                                                                  |
| `list_insurance_requirements`    | List the caller organization's compliance requirements.                    | read                                                                               |
| `create_insurance_requirement`   | Create a typed insurance coverage requirement.                             | write; organization admin only                                                     |
| `list_vendor_compliance`         | List connected-vendor compliance against requirements.                     | read                                                                               |

The `ask_spot`/`ask_glass` MCP annotation describes the outer MCP call. The MCP action also passes the caller's write-scope state into the shared client-tool executors and mailbox coordinator, which removes nested write tools from the executable map for read-only tokens.

## Memory frontends and MCP boundaries

- Client organization memory is available in Settings → Agent → Memory. Direct organization admins can create, edit, and delete stable company facts; other direct members have a read-only view.
- Operators can manage the same client memory from `/operator/clients/:clientOrgId/memory`. The surface and all operator mutations become read-only during client impersonation.
- Procurement memory is a separate client-scoped store for placement preferences, broker appetite, submission requirements, and market observations. Operators manage it from the Memory tab under `/operator/clients/:clientOrgId/procurement`; request, outreach, broker, source, and confidence fields preserve provenance. It is read-only during impersonation.
- Tenant MCP exposes exact-organization company-memory CRUD. Reads require current membership; writes revalidate a current direct admin and OAuth write scope. Tenant MCP does not expose procurement memory.
- Operator MCP receives company-memory and procurement-memory CRUD from the operator registry. Every write uses the ordinary exact-confirmation, role, audit, and no-impersonation boundaries.
