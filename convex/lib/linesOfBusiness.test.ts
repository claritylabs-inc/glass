import { describe, expect, it } from "vitest";
import {
  LEGACY_POLICY_TYPE_TO_LOB as SDK_LEGACY_POLICY_TYPE_TO_LOB,
  normalizeOperationalLinesOfBusiness,
} from "@claritylabs/cl-sdk/policy-taxonomy";
import {
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  LEGACY_POLICY_TYPE_TO_LOB,
  isPersonalLob,
  toLobCodes,
} from "./linesOfBusiness";

const LEGACY_POLICY_TYPE_KEYS = [
  "general_liability",
  "commercial_property",
  "commercial_auto",
  "non_owned_auto",
  "workers_comp",
  "umbrella",
  "excess_liability",
  "professional_liability",
  "cyber",
  "epli",
  "directors_officers",
  "fiduciary_liability",
  "crime_fidelity",
  "inland_marine",
  "builders_risk",
  "environmental",
  "ocean_marine",
  "surety",
  "product_liability",
  "bop",
  "management_liability_package",
  "property",
  "homeowners_ho3",
  "homeowners_ho5",
  "renters_ho4",
  "condo_ho6",
  "dwelling_fire",
  "mobile_home",
  "personal_auto",
  "personal_umbrella",
  "flood_nfip",
  "flood_private",
  "earthquake",
  "personal_inland_marine",
  "watercraft",
  "recreational_vehicle",
  "farm_ranch",
  "life",
  "critical_illness",
  "disability",
  "long_term_care",
  "pet",
  "travel",
  "identity_theft",
  "title",
  "other",
] as const;

describe("linesOfBusiness", () => {
  it("stays in sync with cl-sdk legacy normalization", () => {
    for (const key of LEGACY_POLICY_TYPE_KEYS) {
      expect(normalizeOperationalLinesOfBusiness([key]), key).toEqual(toLobCodes([key]));
      expect(SDK_LEGACY_POLICY_TYPE_TO_LOB[key], key).toEqual(LEGACY_POLICY_TYPE_TO_LOB[key]);
    }
  });

  it("does not expose retired ACORD codes", () => {
    for (const code of EXCLUDED_ACORD_LOB_CODES) {
      expect(ACORD_LOB_LABELS).not.toHaveProperty(code);
    }
    expect(ACORD_LOB_LABELS.CRIM).toBe("Crime");
    expect(toLobCodes(["CRIM"])).toEqual(["CRIM"]);
  });

  it("normalizes idempotently with aliases, dedupe, fallback, and 1-to-N expansion", () => {
    expect(toLobCodes(["CGL", "general_liability", "General Liability"])).toEqual(["CGL"]);
    expect(toLobCodes(["management_liability_package"])).toEqual(["MGMLI"]);
    expect(toLobCodes(["d_and_o", "D&O", "fiduciary", "crime"])).toEqual(["DO", "FIDUC", "CRIM"]);
    expect(toLobCodes(["cyber", "environmental", "product_liability"])).toEqual(["CYBER", "OLIB"]);
    expect(toLobCodes(["travel", "Trip Cancellation"])).toEqual(["TRVL"]);
    expect(toLobCodes(["not_a_real_type"])).toEqual(["UN"]);
    expect(toLobCodes([])).toEqual(["UN"]);
  });

  it("partitions personal and commercial LOBs", () => {
    expect(isPersonalLob("AUTOP")).toBe(true);
    expect(isPersonalLob("AUTOB")).toBe(false);
    expect(isPersonalLob("FLOOD")).toBe(true);
    expect(isPersonalLob("PROP")).toBe(false);
  });

});
