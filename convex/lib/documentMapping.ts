"use node";

/**
 * Maps between cl-sdk InsuranceDocument types and Prism's policies table schema.
 *
 * Replaces the removed applyExtracted / applyExtractedQuote from cl-sdk v0.1.x
 * and the toPolicy / toQuote adapters from agentPrompts.ts.
 */

import type { InsuranceDocument, PolicyDocument, QuoteDocument } from "@claritylabs/cl-sdk";
import { sanitizeNulls } from "@claritylabs/cl-sdk";
import type { Doc } from "../_generated/dataModel";

// Type alias to work around Zod discriminated union inference issues
type AnyDoc = Record<string, unknown>;

/**
 * Map an InsuranceDocument (extraction output) to Prism's policies table fields.
 * This is the forward mapping: SDK extraction → Convex mutation args.
 */
export function insuranceDocToPolicy(doc: InsuranceDocument): Record<string, unknown> {
  // Cast to AnyDoc for property access — the SDK's Zod schema guarantees structure at runtime
  const d = doc as AnyDoc;
  const isQuote = d.type === "quote";
  const policyTypes = Array.isArray(d.policyTypes) && d.policyTypes.length > 0
    ? d.policyTypes
    : ["other"];

  const fields: Record<string, unknown> = {
    carrier: d.carrier || d.security || "Unknown",
    security: d.security ?? undefined,
    underwriter: d.underwriter ?? undefined,
    mga: d.mga ?? undefined,
    broker: d.brokerAgency ?? undefined,
    policyNumber: isQuote ? (d.quoteNumber || "Unknown") : (d.policyNumber || "Unknown"),
    policyTypes,
    documentType: d.type,
    policyYear: d.effectiveDate
      ? new Date(d.effectiveDate).getFullYear()
      : new Date().getFullYear(),
    effectiveDate: d.effectiveDate || "Unknown",
    expirationDate: d.expirationDate ?? "Unknown",
    isRenewal: d.isRenewal ?? false,
    coverages: sanitizeNulls(d.coverages || []),
    premium: d.premium ?? undefined,
    insuredName: d.insuredName || "Unknown",
    summary: d.summary ?? undefined,
    extractionStatus: "complete" as const,
    extractionError: "",
  };

  // Enriched entity fields
  if (d.carrierLegalName) fields.carrierLegalName = d.carrierLegalName;
  if (d.carrierNaicNumber) fields.carrierNaicNumber = d.carrierNaicNumber;
  if (d.carrierAmBestRating) fields.carrierAmBestRating = d.carrierAmBestRating;
  if (d.carrierAdmittedStatus) fields.carrierAdmittedStatus = d.carrierAdmittedStatus;
  if (d.brokerAgency) fields.brokerAgency = d.brokerAgency;
  if (d.brokerContactName) fields.brokerContactName = d.brokerContactName;
  if (d.brokerLicenseNumber) fields.brokerLicenseNumber = d.brokerLicenseNumber;
  // Structured entity objects (cl-sdk 0.11+)
  if (d.insurer) fields.insurer = sanitizeNulls(d.insurer);
  if (d.producer) fields.producer = sanitizeNulls(d.producer);
  if (d.lossPayees?.length) fields.lossPayees = sanitizeNulls(d.lossPayees);
  if (d.mortgageHolders?.length) fields.mortgageHolders = sanitizeNulls(d.mortgageHolders);
  if (d.priorPolicyNumber) fields.priorPolicyNumber = d.priorPolicyNumber;
  if (d.programName) fields.programName = d.programName;
  if (d.isPackage != null) fields.isPackage = d.isPackage;

  // Insured details
  if (d.insuredDba) fields.insuredDba = d.insuredDba;
  if (d.insuredAddress) fields.insuredAddress = sanitizeNulls(d.insuredAddress);
  if (d.insuredEntityType) fields.insuredEntityType = d.insuredEntityType;
  if (d.insuredFein) fields.insuredFein = d.insuredFein;
  if (d.additionalNamedInsureds?.length) {
    fields.additionalNamedInsureds = sanitizeNulls(d.additionalNamedInsureds);
  }

  // Coverage structure
  if (d.coverageForm) fields.coverageForm = d.coverageForm;
  if (d.retroactiveDate) fields.retroactiveDate = d.retroactiveDate;
  if (d.effectiveTime) fields.effectiveTime = d.effectiveTime;
  if (d.limits) fields.limits = sanitizeNulls(d.limits);
  if (d.deductibles) fields.deductibles = sanitizeNulls(d.deductibles);

  // Schedules
  if (d.locations?.length) fields.locations = sanitizeNulls(d.locations);
  if (d.vehicles?.length) fields.vehicles = sanitizeNulls(d.vehicles);
  if (d.classifications?.length) fields.classifications = sanitizeNulls(d.classifications);
  if (d.formInventory?.length) fields.formInventory = sanitizeNulls(d.formInventory);
  if (d.taxesAndFees?.length) fields.taxesAndFees = sanitizeNulls(d.taxesAndFees);

  // Document structure (sections, endorsements, conditions, exclusions)
  const document: Record<string, unknown> = {};
  if (d.sections?.length) document.sections = sanitizeNulls(d.sections);
  if (d.endorsements?.length) document.endorsements = sanitizeNulls(d.endorsements);
  if (d.exclusions?.length) document.exclusions = sanitizeNulls(d.exclusions);
  if (d.conditions?.length) document.conditions = sanitizeNulls(d.conditions);
  if (Object.keys(document).length > 0) fields.document = document;

  // Declarations
  if (d.declarations) fields.declarations = sanitizeNulls(d.declarations);

  // Supplementary facts (cl-sdk 0.13+)
  if (d.supplementaryFacts?.length) fields.supplementaryFacts = sanitizeNulls(d.supplementaryFacts);

  // Policy-specific fields
  if (!isQuote) {
    if (d.policyTermType) fields.policyTermType = d.policyTermType;
    if (d.nextReviewDate) fields.nextReviewDate = d.nextReviewDate;
  }

  // Quote-specific fields
  if (isQuote) {
    if (d.quoteNumber) fields.quoteNumber = d.quoteNumber;
    if (d.proposedEffectiveDate) fields.proposedEffectiveDate = d.proposedEffectiveDate;
    if (d.proposedExpirationDate) fields.proposedExpirationDate = d.proposedExpirationDate;
    if (d.subjectivities?.length) fields.subjectivities = sanitizeNulls(d.subjectivities);
    if (d.underwritingConditions?.length) {
      fields.underwritingConditions = sanitizeNulls(d.underwritingConditions);
    }
    if (d.premiumBreakdown?.length) fields.premiumBreakdown = sanitizeNulls(d.premiumBreakdown);
  }

  return fields;
}

/**
 * Map a Prism policies Doc to an InsuranceDocument (SDK type).
 * This is the reverse mapping: Convex Doc → SDK interface.
 * Used by DocumentStore.get/query and agent context building.
 */
export function policyToInsuranceDoc(p: Doc<"policies">): InsuranceDocument {
  const isQuote = p.documentType === "quote";

  const base = {
    id: p._id as string,
    carrier: p.carrier,
    security: p.security,
    insuredName: p.insuredName,
    premium: p.premium,
    summary: p.summary,
    policyTypes: p.policyTypes,
    coverages: p.coverages as unknown[] || [],
    effectiveDate: p.effectiveDate,
    expirationDate: p.expirationDate,
    // Enriched entity
    carrierLegalName: p.carrierLegalName,
    carrierNaicNumber: p.carrierNaicNumber,
    carrierAmBestRating: p.carrierAmBestRating,
    carrierAdmittedStatus: p.carrierAdmittedStatus,
    mga: p.mga,
    underwriter: p.underwriter,
    brokerAgency: p.brokerAgency,
    brokerContactName: p.brokerContactName,
    brokerLicenseNumber: p.brokerLicenseNumber,
    priorPolicyNumber: p.priorPolicyNumber,
    programName: p.programName,
    isRenewal: p.isRenewal,
    isPackage: p.isPackage,
    // Structured entities (cl-sdk 0.11+)
    insurer: p.insurer as unknown,
    producer: p.producer as unknown,
    lossPayees: p.lossPayees as unknown,
    mortgageHolders: p.mortgageHolders as unknown,
    // Insured details
    insuredDba: p.insuredDba,
    insuredAddress: p.insuredAddress as unknown,
    insuredEntityType: p.insuredEntityType,
    insuredFein: p.insuredFein,
    additionalNamedInsureds: p.additionalNamedInsureds as unknown,
    // Coverage structure
    coverageForm: p.coverageForm,
    retroactiveDate: p.retroactiveDate,
    effectiveTime: p.effectiveTime,
    limits: p.limits as unknown,
    deductibles: p.deductibles as unknown,
    // Schedules
    locations: p.locations as unknown,
    vehicles: p.vehicles as unknown,
    classifications: p.classifications as unknown,
    formInventory: p.formInventory as unknown,
    taxesAndFees: p.taxesAndFees as unknown,
    // Document structure
    sections: (p.document as unknown)?.sections,
    endorsements: (p.document as unknown)?.endorsements,
    exclusions: (p.document as unknown)?.exclusions,
    conditions: (p.document as unknown)?.conditions,
    // Declarations
    declarations: p.declarations as unknown,
    // Supplementary facts (cl-sdk 0.13+)
    supplementaryFacts: p.supplementaryFacts as unknown,
  };

  if (isQuote) {
    return {
      ...base,
      type: "quote" as const,
      quoteNumber: p.quoteNumber || p.policyNumber,
      proposedEffectiveDate: p.proposedEffectiveDate,
      proposedExpirationDate: p.proposedExpirationDate,
      subjectivities: p.subjectivities as unknown,
      underwritingConditions: p.underwritingConditions as unknown,
      premiumBreakdown: p.premiumBreakdown as unknown,
    } as QuoteDocument;
  }

  return {
    ...base,
    type: "policy" as const,
    policyNumber: p.policyNumber,
    policyTermType: p.policyTermType as unknown,
    nextReviewDate: p.nextReviewDate,
  } as PolicyDocument;
}
