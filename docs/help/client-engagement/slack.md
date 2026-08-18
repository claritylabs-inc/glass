# Slack

Slack is Glass's team collaboration and human-support surface. A client can use
Glass in direct messages, in a dedicated Slack Connect support channel, and in
other channels where the app has been added.

## Understand the two invitations

Slack setup normally includes two separate invitations:

1. **Install the Glass app** in the client's Slack workspace. This authorizes
   Glass to receive supported messages and send replies.
2. **Accept the Slack Connect invitation** to the private Glass support channel
   hosted by Clarity Labs. This creates the shared place where Glass operators
   can join the conversation.

Accepting one does not accept the other. A Slack workspace administrator may
need to approve the app installation or Slack Connect invitation.

## Complete setup

1. Open **Settings → Agent → Channels → Slack** in Glass.
2. Follow the installation invitation for the correct workspace.
3. Accept the separate invitation to the named Glass support channel.
4. Add Glass to any additional channels where the team wants to use it.
5. Return to Glass and use **Refresh channels** if a private or Slack Connect
   channel is missing.
6. Choose one channel for automatic alerts and document delivery.
7. Review the automation toggles:
   - **Compliance and policy-change alerts**;
   - **Vendor alerts**; and
   - **Policy and endorsement delivery**.

The selected automatic channel affects only proactive posts and document
delivery. Glass can still answer in every joined channel.

Client administrators and Glass operators can add Glass to visible public
channels from the Glass settings page. For a private or Slack Connect channel,
a Slack member must add the Glass app inside Slack; Glass cannot join it on its
own.

## Recover a disconnected workspace or channel

Glass shows Slack connection health, the last verification time, and an
actionable reason in **Settings → Agent → Channels → Slack**. Client admins and
Glass operators can choose **Reinstall Slack** after an uninstall or bot-token
revocation. Reinstall into the same retained workspace; Glass preserves the
canonical support history, channel choices, and automation preferences while
delivery is paused.

If the primary Slack Connect channel is archived, deleted, or unshared, Glass
marks it unavailable and stops replies, alerts, and document delivery to that
destination. A Glass operator must verify the same channel or use **Rebind
primary channel** for a replacement. Glass never selects a replacement merely
because its name matches. Ordinary members and operators viewing through
impersonation can inspect health but cannot run recovery actions.

## Where to talk to Glass

| Place                      | How to start                                | What happens next                                                                   |
| -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Glass app **Messages** tab | Send a direct message; no mention required  | One continuous private conversation for that Slack member                           |
| Dedicated support channel  | Mention `@Glass` to start or resume         | Your unmentioned replies continue the active thread; a Glass operator can take over |
| Another joined channel     | Mention `@Glass` in a new message or thread | Replies in that active thread continue without repeating the mention                |

Multiparty Slack DMs are not supported. Use a channel or a one-to-one DM.

In a busy channel, keep each request in its own Slack thread. That preserves the
right context and keeps unrelated conversations from being combined.

## Ask for a human or close a request

To pause the AI and request human help, mention Glass and send one of these as
the complete request:

- `@Glass human`
- `@Glass person`
- `@Glass operator`
- `@Glass handoff`
- `@Glass human help`
- `@Glass talk to a human`

In a channel other than the dedicated support channel, Glass posts only a link
notice in the support channel; it does not copy the request's confidential text
there. Continue the substantive conversation with the operator in the place
whose audience is appropriate.

A message from a Glass operator in the support thread pauses AI replies. Mention
Glass again when you want the AI to resume. In the support channel, send
`@Glass resolve`, `@Glass resolved`, `@Glass close`, or `@Glass closed` to mark
the request resolved. A later mention starts it again.

## Files

A Slack message may include up to 10 files, with these ingestion limits:

- 25 MB per file; and
- 50 MB total per message.

Glass stores the files it successfully processes with the conversation. It can
also return policy PDFs and generated documents. If a file is above a limit,
send a smaller version or split the request across messages.

## Automatic posts

Slack has three independent automation categories:

| Setting                                 | Posts                                                           |
| --------------------------------------- | --------------------------------------------------------------- |
| **Compliance and policy-change alerts** | Client compliance gaps or resolutions and policy-change updates |
| **Vendor alerts**                       | Vendor compliance gaps, expirations, and resolutions            |
| **Policy and endorsement delivery**     | Client-owned policy and endorsement documents                   |

Automatic posts require an active Slack connection and a selected automatic
channel. Policy document delivery also has to be enabled and allowed under
**Settings → Workflows → Delivery**. Turning on the Slack automation by itself
does not override a delivery rule or a review hold.

## What appears in Glass

Slack conversations create or update threads in the Glass web app:

- shared support and public-channel conversations are visible to the client
  organization;
- a direct message is marked **Private** when the Slack profile email matches a
  current Glass member;
- a private non-support channel is private to the mapped member who began the
  conversation; and
- when no safe member match exists, the conversation can continue in Slack but
  remains absent from the shared Glass workspace.

Slack threads are read-only in Glass. Use **Open in Slack** to reply. Recent
Slack activity appears with the agent conversations; older active items remain
available under **All threads**.

Editing a Slack message updates its mirrored revision. Deleting it removes its
mirrored content and stored attachments without rerunning the agent. A new
Slack message restores an archived mirror.

## Permissions and privacy

Glass requests Slack permissions needed to receive app mentions and messages in
places where it participates, reply, transfer files, list or join selected
channels, and resolve a sender's workspace identity. Email lookup is used to
authorize the sender and create a private Glass mirror when possible.

Practical boundaries:

- Glass responds to DMs, mentions, and replies in an active Glass thread.
- In the support channel, it also records the conversation so an operator can
  participate.
- Outside the support channel, an unmentioned message that is not part of an
  active Glass thread is ignored.
- Bot and unrecognized external actors are ignored.
- Everyone in a public, private, or Slack Connect channel can see the Glass
  reply posted there. Slack Connect may include people outside your company.

Use a DM or the signed-in web app for information that should not be visible to
the channel. Review the channel member list before uploading a policy or COI.

## Troubleshooting

### Glass does not respond in a channel

1. Confirm the Glass app is a member of the channel.
2. In a new conversation outside the support channel, mention `@Glass`.
3. Reply inside the existing Glass thread rather than starting an unmentioned
   top-level message.
4. If a human took over, mention Glass to resume the AI.
5. Check **Settings → Agent → Channels → Slack** for a setup or authorization
   warning.

### A private or Slack Connect channel is missing in settings

Add the Glass app from inside that Slack channel, then use **Refresh channels**
in Glass. Private and Slack Connect channels cannot be joined from the Glass
settings page.

### The support channel is present but the app is not installed

The Slack Connect invitation and app installation are separate. Return to the
Slack setup flow and complete the app-install invitation for the client's own
workspace.

### Slack asks to approve new permissions

A Slack administrator must reauthorize the app before features that depend on
the new permissions work. Use the reconnect or install action shown in Glass.

### My DM does not appear in Glass

Make sure the email on your Slack profile matches the email of a current member
in the client workspace. The DM can continue safely in Slack even when Glass
cannot create the private web mirror.

### Automatic alerts or documents do not appear

Confirm all of the following:

- Slack is enabled for the client;
- an automatic channel is selected and Glass is still a member;
- the relevant Slack automation toggle is on; and
- for policy documents, the delivery workflow permits sending and the policy is
  fully processed.

### A file fails

Keep the message to at most 10 files, each at most 25 MB, and no more than 50 MB
in total. If the limit is not the issue, retry in the same thread so the request
history remains intact.

### A reply shows retrying or failed in Glass

Continue to treat the Slack thread as the source of truth. Retry after the
connection recovers; do not assume a response marked failed reached Slack.

### Disconnecting Slack

Disconnect only when the client intends to remove Glass from the workspace. It
uninstalls the app, disables outbound retries, and stops new Slack activity.
Existing Glass records are retained for audit and conversation history.
