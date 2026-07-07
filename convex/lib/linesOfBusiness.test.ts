import { describe, expect, it } from "vitest";
import { POLICY_TYPE_LABELS } from "./policyTypes";
import {
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  LEGACY_POLICY_TYPE_TO_LOB,
  isPersonalLob,
  lobBadgeClass,
  lobLabel,
  policyLobCodes,
  toLobCodes,
} from "./linesOfBusiness";

describe("linesOfBusiness", () => {
  it("maps every legacy policy type", () => {
    expect(Object.keys(POLICY_TYPE_LABELS).sort()).toEqual(
      expect.arrayContaining(Object.keys(LEGACY_POLICY_TYPE_TO_LOB).filter((key) => key in POLICY_TYPE_LABELS).sort()),
    );
    for (const key of Object.keys(POLICY_TYPE_LABELS)) {
      expect(LEGACY_POLICY_TYPE_TO_LOB[key], key).toBeDefined();
    }
  });

  it("does not expose excluded or duplicate ACORD codes", () => {
    for (const code of EXCLUDED_ACORD_LOB_CODES) {
      expect(ACORD_LOB_LABELS).not.toHaveProperty(code);
    }
    expect(ACORD_LOB_LABELS).not.toHaveProperty("CRIM");
    expect(toLobCodes(["CRIM"])).toEqual(["CRIME"]);
  });

  it("normalizes idempotently with aliases, dedupe, fallback, and 1-to-N expansion", () => {
    expect(toLobCodes(["CGL", "general_liability", "General Liability"])).toEqual(["CGL"]);
    expect(toLobCodes(["management_liability_package"])).toEqual(["DO", "EPLI", "FIDUC"]);
    expect(toLobCodes(["d_and_o", "D&O", "fiduciary", "crime"])).toEqual(["DO", "FIDUC", "CRIME"]);
    expect(toLobCodes(["cyber", "environmental", "product_liability"])).toEqual(["OLIB"]);
    expect(toLobCodes(["not_a_real_type"])).toEqual(["UN"]);
    expect(toLobCodes([])).toEqual(["UN"]);
  });

  it("partitions personal and commercial LOBs", () => {
    expect(isPersonalLob("AUTOP")).toBe(true);
    expect(isPersonalLob("AUTOB")).toBe(false);
    expect(isPersonalLob("FLOOD")).toBe(true);
    expect(isPersonalLob("PROP")).toBe(false);
  });

  it("labels and badge-colors codes and legacy keys through the same path", () => {
    expect(lobLabel("general_liability")).toBe(lobLabel("CGL"));
    expect(lobLabel("cyber")).toBe("Other Liability");
    expect(lobBadgeClass("general_liability")).toBe(lobBadgeClass("CGL"));
  });

  it("reads linesOfBusiness before legacy policyTypes during migration", () => {
    expect(policyLobCodes({ linesOfBusiness: ["CGL"], policyTypes: ["cyber"] })).toEqual(["CGL"]);
    expect(policyLobCodes({ policyTypes: ["cyber"] })).toEqual(["OLIB"]);
  });
});
