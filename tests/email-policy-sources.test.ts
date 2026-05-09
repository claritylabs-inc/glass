import { describe, expect, it } from "vitest";
import {
  buildPolicySourcesHtml,
  buildPolicySourcesText,
  type EmailPolicySource,
} from "../convex/lib/emailPolicySources";
import { buildEmailSignature } from "../convex/lib/emailSubagent";

const sources: EmailPolicySource[] = [
  {
    id: "policy123" as EmailPolicySource["id"],
    href: "https://glass.claritylabs.inc/policies/policy123",
    label: "Policy",
    title: "Acme Casualty GL-100 - General Liability",
    detail: "Policy GL-100",
  },
];

describe("email policy sources", () => {
  it("renders policy links as a separate sources block", () => {
    const text = buildPolicySourcesText(sources);
    const html = buildPolicySourcesHtml(sources);

    expect(text).toContain("\n\nSources\n");
    expect(text).toContain("https://glass.claritylabs.inc/policies/policy123");
    expect(html).toContain(">Sources<");
    expect(html).toContain("https://glass.claritylabs.inc/policies/policy123");
    expect(html).toContain("padding:7px 9px");
    expect(html).toContain("color:#374151");
  });
});

describe("email signatures", () => {
  it("omits powered-by text for the default Glass signature", () => {
    const signature = buildEmailSignature("agent@glass.claritylabs.inc");

    expect(signature.text).not.toContain("powered by Glass from Clarity Labs");
    expect(signature.html).not.toContain("powered by Glass from Clarity Labs");
  });

  it("keeps powered-by text for white-labeled broker signatures", () => {
    const signature = buildEmailSignature("acme@glass.claritylabs.inc", {
      name: "Acme Risk",
    });

    expect(signature.text).toContain("powered by Glass from Clarity Labs");
    expect(signature.html).toContain("powered by Glass from Clarity Labs");
  });
});
