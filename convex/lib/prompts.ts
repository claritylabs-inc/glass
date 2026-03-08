/**
 * Extraction prompt for insurance policy documents.
 * Single source of truth — used by extractPolicy, retryExtraction, and reExtractFromFile.
 */

/**
 * @deprecated No longer used for new extractions. Kept for backward compatibility
 * with rawExtractionResponse reparse (older extractions may have used this format).
 * New extractions use two-pass flow: METADATA_PROMPT (Sonnet) + buildSectionsPrompt (Haiku).
 */
export const EXTRACTION_PROMPT = `You are an expert insurance document analyst. Extract comprehensive structured data from this insurance document. Preserve original language verbatim — do not summarize or paraphrase section content.

Respond with JSON only. The JSON must follow this exact structure:

{
  "metadata": {
    "carrier": "primary insurance company name (for display purposes)",
    "security": "insurer or underwriter entity providing coverage, e.g. 'Lloyd's Underwriters' — the legal entity on risk",
    "underwriter": "named individual underwriter if listed, or null",
    "mga": "Managing General Agent or Program Administrator name if applicable (e.g. 'CFC Underwriting'), or null",
    "broker": "insurance broker name if identifiable, or null",
    "policyNumber": "policy or quote reference number",
    "documentType": "policy" or "quote",
    "policyTypes": ["general_liability", "workers_comp", "commercial_auto", "non_owned_auto", "property", "umbrella", "professional_liability", "cyber", "epli", "directors_officers", "other"],
    "policyYear": number,
    "effectiveDate": "MM/DD/YYYY",
    "expirationDate": "MM/DD/YYYY",
    "isRenewal": boolean,
    "premium": "$X,XXX",
    "insuredName": "name of insured party",
    "summary": "1-2 sentence summary of the document"
  },
  "metadataSource": {
    "carrierPage": number or null,
    "policyNumberPage": number or null,
    "premiumPage": number or null,
    "effectiveDatePage": number or null
  },
  "coverages": [
    {
      "name": "coverage name",
      "limit": "$X,XXX,XXX",
      "deductible": "$X,XXX or null",
      "pageNumber": number,
      "sectionRef": "section number reference or null"
    }
  ],
  "document": {
    "sections": [
      {
        "title": "section title",
        "sectionNumber": "e.g. 'I', '1.1', 'A' — or null if unnumbered",
        "pageStart": number,
        "pageEnd": number or null,
        "type": "one of: declarations, insuring_agreement, exclusion, condition, definition, endorsement, schedule, subjectivity, warranty, notice, regulatory, other",
        "coverageType": "links to policyTypes value if section is coverage-specific, or null",
        "content": "full verbatim text of the section",
        "subsections": [
          {
            "title": "subsection title",
            "sectionNumber": "subsection number or null",
            "pageNumber": number or null,
            "content": "full verbatim text"
          }
        ]
      }
    ],
    "regulatoryContext": {
      "content": "all regulatory context, governing law, jurisdiction clauses — verbatim",
      "pageNumber": number
    },
    "complaintContact": {
      "content": "complaint contact information and instructions — verbatim",
      "pageNumber": number
    },
    "costsAndFees": {
      "content": "other costs, fees, surcharges, and charges — verbatim",
      "pageNumber": number
    }
  },
  "totalPages": number
}

IMPORTANT INSTRUCTIONS:
- policyTypes should include ALL coverage types found in the document
- documentType should be "quote" if this is a quote/proposal, "policy" if it is a bound policy
- For carrier, use the primary company name. For security, use the full legal entity providing coverage
- Extract EVERY section, clause, endorsement, and schedule from the document as a separate entry in document.sections
- Preserve the original language exactly as written in the document — do not summarize
- Include accurate page numbers for every section and data point
- Classify each section by type (declarations, insuring_agreement, exclusion, condition, etc.)
- If a section relates to a specific coverage type, set coverageType to match the policyTypes value
- For regulatoryContext, complaintContact, and costsAndFees: set to null if not found in the document
- subsections within a section are optional — only include if the section has clearly defined subsections`;

/**
 * Chunked extraction: metadata-only prompt for the first pass on long documents.
 */
export const METADATA_PROMPT = `You are an expert insurance document analyst. Extract ONLY the high-level metadata from this insurance document. Do NOT extract full section content — that will be done in a separate pass.

Respond with JSON only:

{
  "metadata": {
    "carrier": "primary insurance company name",
    "security": "insurer or underwriter entity providing coverage, or null",
    "underwriter": "named individual underwriter, or null",
    "mga": "MGA or Program Administrator, or null",
    "broker": "insurance broker, or null",
    "policyNumber": "policy number",
    "documentType": "policy" or "quote",
    "policyTypes": ["general_liability", ...],
    "policyYear": number,
    "effectiveDate": "MM/DD/YYYY",
    "expirationDate": "MM/DD/YYYY",
    "isRenewal": boolean,
    "premium": "$X,XXX",
    "insuredName": "name of insured party",
    "summary": "1-2 sentence summary"
  },
  "metadataSource": {
    "carrierPage": number or null,
    "policyNumberPage": number or null,
    "premiumPage": number or null,
    "effectiveDatePage": number or null
  },
  "coverages": [
    { "name": "coverage name", "limit": "$X,XXX,XXX", "deductible": "$X,XXX or null", "pageNumber": number, "sectionRef": "section ref or null" }
  ],
  "totalPages": number,
  "tableOfContents": [
    { "title": "section title", "pageStart": number, "pageEnd": number }
  ]
}`;

/**
 * Chunked extraction: sections prompt for a specific page range.
 */
export function buildSectionsPrompt(pageStart: number, pageEnd: number): string {
  return `You are an expert insurance document analyst. Extract ALL sections, clauses, endorsements, and schedules found on pages ${pageStart} through ${pageEnd} of this document. Preserve the original language verbatim.

Respond with JSON only:

{
  "sections": [
    {
      "title": "section title",
      "sectionNumber": "section number or null",
      "pageStart": number,
      "pageEnd": number or null,
      "type": "one of: declarations, insuring_agreement, exclusion, condition, definition, endorsement, schedule, subjectivity, warranty, notice, regulatory, other",
      "coverageType": "policyTypes value if coverage-specific, or null",
      "content": "full verbatim text of the section",
      "subsections": [
        { "title": "subsection title", "sectionNumber": "or null", "pageNumber": number, "content": "full verbatim text" }
      ]
    }
  ],
  "regulatoryContext": { "content": "verbatim text", "pageNumber": number } or null,
  "complaintContact": { "content": "verbatim text", "pageNumber": number } or null,
  "costsAndFees": { "content": "verbatim text", "pageNumber": number } or null,
  "claimsContact": { "content": "verbatim text about how to report/file claims", "pageNumber": number } or null
}

IMPORTANT: Only extract content from pages ${pageStart}-${pageEnd}. Preserve original language exactly.`;
}

/**
 * Pass 3: Supplementary field enrichment prompt.
 * Text-only (no PDF) — parses raw text blobs into structured data.
 */
export function buildSupplementaryEnrichmentPrompt(
  fields: {
    regulatoryContext?: string;
    complaintContact?: string;
    costsAndFees?: string;
    claimsContact?: string;
  },
): string {
  const parts: string[] = [];

  parts.push(`You are an expert insurance document analyst. Parse the following raw text excerpts from an insurance policy into structured data. Respond with JSON only.

{`);

  const fieldPrompts: string[] = [];

  if (fields.regulatoryContext) {
    fieldPrompts.push(`  "regulatoryContext": {
    "jurisdiction": "state or jurisdiction mentioned, or null",
    "regulatoryBody": "name of regulatory body/department, or null",
    "governingLaw": "governing law or statute cited, or null",
    "details": [{ "label": "descriptive label", "value": "extracted value" }]
  }`);
  }

  if (fields.complaintContact) {
    fieldPrompts.push(`  "complaintContact": {
    "contacts": [
      {
        "name": "organization or person name, or null",
        "type": "e.g. 'State Department of Insurance', 'Carrier', 'Ombudsman', or null",
        "phone": "phone number or null",
        "fax": "fax number or null",
        "email": "email address or null",
        "title": "job title or null",
        "address": "mailing address or null"
      }
    ]
  }`);
  }

  if (fields.costsAndFees) {
    fieldPrompts.push(`  "costsAndFees": {
    "fees": [
      {
        "name": "fee or charge name",
        "amount": "dollar amount or percentage, or null",
        "description": "brief description, or null",
        "type": "e.g. 'surcharge', 'tax', 'fee', 'assessment', or null"
      }
    ]
  }`);
  }

  if (fields.claimsContact) {
    fieldPrompts.push(`  "claimsContact": {
    "contacts": [
      {
        "name": "organization or person name, or null",
        "phone": "phone number or null",
        "fax": "fax number or null",
        "email": "email address or null",
        "address": "mailing address or null",
        "hours": "hours of operation or null"
      }
    ],
    "processSteps": ["step 1 description", "step 2 description"],
    "reportingTimeLimit": "time limit for reporting claims, or null"
  }`);
  }

  parts.push(fieldPrompts.join(",\n"));
  parts.push(`\n}`);

  parts.push(`\n\nIMPORTANT: Only include fields shown above. Extract all relevant structured data from the raw text. If a sub-field cannot be determined, use null.\n`);

  // Append raw text for each field
  parts.push(`\n--- RAW TEXT INPUTS ---\n`);

  if (fields.regulatoryContext) {
    parts.push(`\n[REGULATORY CONTEXT]\n${fields.regulatoryContext}\n`);
  }
  if (fields.complaintContact) {
    parts.push(`\n[COMPLAINT CONTACT]\n${fields.complaintContact}\n`);
  }
  if (fields.costsAndFees) {
    parts.push(`\n[COSTS AND FEES]\n${fields.costsAndFees}\n`);
  }
  if (fields.claimsContact) {
    parts.push(`\n[CLAIMS CONTACT]\n${fields.claimsContact}\n`);
  }

  return parts.join("");
}
