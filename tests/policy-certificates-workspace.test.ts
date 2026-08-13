import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("policy certificate workspace", () => {
  it("shares the certificate table while omitting the redundant policy column", () => {
    const workspace = read("components/certificates/certificate-workspace.tsx");
    const certificatesPage = read(
      "components/certificates/certificates-workspace.tsx",
    );
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

  it("generates from certificate pages through one policy-or-requirements drawer", () => {
    const certificatesPage = read("components/certificates/certificates-workspace.tsx");
    const generatePanel = read(
      "components/certificates/certificate-generate-panel.tsx",
    );
    const managedClientPage = read(
      "app/clients/[clientOrgId]/certificates/page.tsx",
    );
    const operatorPage = read(
      "app/operator/clients/[clientOrgId]/certificates/operator-certificates-workspace.tsx",
    );

    expect(certificatesPage).toContain("Generate certificate");
    expect(generatePanel).toContain('value="policy">Policy');
    expect(generatePanel).toContain('value="requirements">Requirements source');
    expect(generatePanel).toContain("requirementSourceDocumentId");
    expect(generatePanel).not.toContain("Add requirements");
    expect(generatePanel).toContain("api.certificates.generateBatchForPolicy");
    expect(generatePanel).toContain("every available coverage");
    expect(managedClientPage).toContain("<CertificatesWorkspace");
    expect(operatorPage).toContain("<CertificateGeneratePanel");

    const searchableSelect = read("components/ui/searchable-select.tsx");
    expect(searchableSelect).toContain("min-w-0 flex-1 truncate");
  });

  it("archives a selected certificate through the shared detail drawer", () => {
    const detail = read("app/policies/[id]/policy-detail-body.tsx");

    expect(detail).toContain("api.certificateLifecycle.archive");
    expect(detail).toContain("await archiveCertificateMutation({ certificateId: row._id })");
    expect(detail).toContain("onArchive={!readOnly ? archiveCertificate : undefined}");
    expect(detail).toContain("archiving={archivingCertificateId === selectedCertificateForPanel._id}");
  });

  it("supports compact client actions and labeled operator actions", () => {
    const workspace = read("components/certificates/certificate-workspace.tsx");

    expect(workspace).toContain('label="Archive"');
    expect(workspace).toContain('label="Reissue"');
    expect(workspace).toContain('label="Edit"');
    expect(workspace).toContain('actionPresentation?: "icons" | "labels"');
    expect(workspace).toContain('actionPresentation === "labels" ? "secondary" : "icon"');
    expect(workspace).toContain('actionPresentation === "labels" ? "Edit holder" : null');
  });

  it("edits holder details by issuing the next certificate version", () => {
    const workspace = read("components/certificates/certificate-workspace.tsx");
    const certificatesPage = read(
      "components/certificates/certificates-workspace.tsx",
    );
    const policyDetail = read("app/policies/[id]/policy-detail-body.tsx");
    const certificates = read("convex/certificates.ts");
    const lifecycle = read("convex/certificateLifecycle.ts");

    expect(workspace).toContain("Generate new version");
    expect(workspace).toContain("certificate-holder-edit-form");
    expect(workspace).not.toContain("Update the holder details shown on the certificate");
    expect(workspace).toContain("certificateVersionActionInput");
    expect(workspace).toContain("updateHolderDetails: Boolean(draft)");
    expect(certificatesPage).toContain(
      "onEditHolder={!readOnly ? editCertificateHolder : undefined}",
    );
    expect(policyDetail).toContain(
      "onEditHolder={!readOnly ? editCertificateHolder : undefined}",
    );
    expect(certificates).toContain("getCertificateGenerationTargetForOrg");
    expect(certificates).toContain("!args.certificateId");
    expect(lifecycle).toContain("if (args.updateHolderDetails)");
  });
});
