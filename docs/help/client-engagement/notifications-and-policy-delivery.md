# Notifications and policy delivery

Notifications tell a user that something changed. Policy delivery sends the
actual completed policy or endorsement document. They are separate controls,
even when both use email, iMessage, or Slack.

## In-app notifications

Use the bell menu to see unread and read notifications. Selecting a notification
opens the relevant policy, conversation, mailbox item, or compliance record.
Use **Mark all as read** when you have reviewed the current list.

Client-visible categories include:

- mailbox items that need attention;
- a compliance gap in the client's own insurance, or its resolution;
- policy extraction that needs review;
- a policy change that needs information, or has completed;
- vendor compliance gaps and resolutions; and
- vendor policies that are expiring or expired.

Several similar proactive events may be combined into one alert during a
24-hour period to reduce noise. Unread informational notifications older than
30 days may be dismissed automatically; warnings and critical events are not
removed by that informational cleanup.

## Personal notification preferences

Open **Settings → Workflows → Notifications**. These preferences belong to the
current user in the current organization.

1. Set **Default email delivery** and **Default text delivery** if you want one
   rule for event types without a custom setting.
2. Open an individual event row to enable or disable email and text for that
   event.
3. Leave an event on **Default** when it should follow the global choice.

If you have never set a default, Spot emails warning and critical events,
does not email informational events, and keeps text delivery off. Text delivery
requires the correct phone number on your Spot profile and an available
iMessage channel.

These settings control email and text copies. The underlying workspace event
and its in-app notification remain available to authorized users.

Slack alert settings are separate. Configure them under **Settings → Agent →
Channels → Slack**, where client-compliance and policy-change alerts are
separate from vendor alerts.

## Automatic policy delivery

Open **Settings → Workflows → Delivery**. After a bound policy or endorsement
finishes processing, Spot can deliver its PDF through client-owned email,
iMessage, and Slack channels.

Client administrators and Spot operators can edit the client's delivery
settings. A client may inherit broker defaults until an authorized person adds
a client-specific override.

### Main settings

| Setting                            | Effect                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| **Deliver processed documents**    | Turns the workflow on or off                                                  |
| **Send by**                        | Selects email, iMessage, Slack, or a combination                              |
| **Default outcome**                | Chooses what happens when no rule matches                                     |
| **Allow before invite acceptance** | Allows use of the saved primary contact before the client finishes onboarding |
| **Message instructions**           | Guides the delivery wording, such as including claims contact details         |

The available outcomes are:

- **Send automatically** — send as soon as all delivery checks pass.
- **Hold for broker review** — create a review item before sending.
- **Hold for Spot service review** — route the item to the Spot service team.
- **Do not send** — retain the record without automatic delivery.

### Delivery rules

Rules are checked in order before the default outcome. A rule can filter by
insurer or market, line of business, and an additional written condition. It
can choose its own outcome, channels, and copy instructions. Smaller priority
numbers are checked first.

Write conditions so a reviewer can tell why they matched. For example:

`Hold for broker review when an endorsement changes the named insured or adds an exclusion.`

If a condition cannot be evaluated confidently, Spot holds the delivery for
review rather than assuming it should send.

### Channel requirements

| Channel  | Required before sending                                                                   |
| -------- | ----------------------------------------------------------------------------------------- |
| Email    | A usable client recipient email and configured sender                                     |
| iMessage | A usable client phone number and available iMessage channel                               |
| Slack    | Active Slack connection, policy-delivery automation on, and an automatic channel selected |

Spot resolves the recipient from saved client contacts and membership data.
Review the primary contact's name, email, and phone before enabling automatic
delivery. A multi-channel job may succeed on one channel and remain blocked or
failed on another; check the recorded attempts.

### When delivery is held

Automatic delivery is limited to fully processed final policies and
endorsements. It can be held when:

- policy enrichment has not finished;
- extraction needs review;
- the configured rule requires broker or service review;
- a rule cannot be evaluated safely;
- the client invitation is not accepted and early delivery is off;
- no selected channel has a valid recipient; or
- the Slack connection or automatic channel is unavailable.

The delivery record preserves the decision, generated message, document, and
per-channel attempts. Resolve the displayed issue and retry the held or failed
attempt rather than creating an unrelated duplicate delivery.

## Certificate renewal workflow

Under **Settings → Workflows → Certificates**, **Update certificates on
renewal** controls whether Spot reviews active certificates and prepares
updated versions when a renewed policy is uploaded. Prepared certificates may
still require source completion or review before they can be sent.

## Troubleshooting

### I receive an in-app alert but no email

Open your notification settings for that organization. Check the event's custom
choice first, then the default email setting, and confirm your account email is
current.

### I receive email but no text

Text is off by default. Enable it for the event or as the default, confirm the
phone number on your profile, and confirm iMessage is available for the client.

### Slack alerts work but policy PDFs do not

The general Slack alert setting is not enough. Confirm **Policy and endorsement
delivery** is on in Slack settings, then confirm the delivery workflow selects
Slack and permits the policy to send.

### A policy is held for review

Open the delivery record and read its reason. Review the extraction, rule match,
recipient, and document. An authorized reviewer can then approve or retry it.

### Nothing was sent after processing

Confirm that **Deliver processed documents** is on, the document is a final
bound policy or endorsement, the default or matching rule does not say **Do not
send**, and at least one selected channel is usable.

### The wrong person received a document

Disable automatic delivery while the contact record and rule are corrected.
Review the delivery attempts to identify the channel and recipient, then follow
your organization's incident process for any unintended disclosure.
