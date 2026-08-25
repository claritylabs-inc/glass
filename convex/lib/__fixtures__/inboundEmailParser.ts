export const gmailReplyFixture = {
  subject: "Re: Renewal documents",
  text: `Thanks, please proceed with the renewal.

On Mon, Aug 24, 2026 at 9:00 AM Alice Example <alice@example.com> wrote:
> Can you confirm whether we should proceed?
> The renewal documents are attached.`,
};

export const gmailForwardFixture = {
  subject: "Fwd: Certificate request",
  text: `Please review this request and tell me what is needed.

---------- Forwarded message ---------
From: Alice Example <alice@example.com>
Date: Mon, Aug 24, 2026 at 8:12 AM
Subject: Certificate request
To: Terry Example <terry@example.com>

Could you send a certificate showing the landlord as certificate holder?`,
};

export const rewrittenSubjectForwardFixture = {
  subject: "Please handle this certificate request",
  text: `Can you take a look?

---------- Forwarded message ---------
From: Vendor Risk <risk@vendor.example>
Date: Mon, Aug 24, 2026 at 8:12 AM
Subject: Evidence of insurance
To: Terry Example <terry@example.com>

Please provide evidence of insurance by Friday.`,
};
