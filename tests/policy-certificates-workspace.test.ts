import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("policy certificate workspace", () => {
  it("shares the certificate table while omitting the redundant policy column", () => {
    const workspace = read("components/certificates/certificate-workspace.tsx");
    const certificatesPage = read("app/certificates/page.tsx");
    const policyTab = read("app/policies/[id]/policy-certificates-tab.tsx");

    expect(workspace).toContain("export function CertificatesTable");
    expect(workspace).toContain("showPolicyColumn = true");
    expect(workspace).toContain("Holder");
    expect(workspace).toContain("Address");
    expect(workspace).toContain("Contact");
    expect(workspace).toContain("Issued");
    expect(certificatesPage).toContain("<CertificatesTable");
    expect(policyTab).toContain("<CertificatesTable");
    expect(policyTab).toContain("showPolicyColumn={false}");
    expect(policyTab).not.toContain("CertificatePolicyGroupCard");
  });

  it("archives a selected certificate through the shared detail drawer", () => {
    const detail = read("app/policies/[id]/policy-detail-body.tsx");

    expect(detail).toContain("api.certificateLifecycle.archive");
    expect(detail).toContain("await archiveCertificateMutation({ certificateId: row._id })");
    expect(detail).toContain("onArchive={!readOnly ? archiveCertificate : undefined}");
    expect(detail).toContain("archiving={archivingCertificateId === selectedCertificateForPanel._id}");
  });
});
