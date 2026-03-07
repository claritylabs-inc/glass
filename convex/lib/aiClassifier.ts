export const CLASSIFY_EMAIL_PROMPT = `You are an AI assistant that classifies emails. Determine if this email is related to insurance policies (new policies, renewals, certificates of insurance, policy documents, endorsements, binders, premium notices, etc).

Respond with JSON only:
{
  "isInsurance": boolean,
  "reason": "brief explanation",
  "confidence": number between 0 and 1
}

Email subject: {{subject}}
From: {{from}}
Date: {{date}}`;

export const EXTRACT_POLICY_PROMPT = `You are an AI assistant that extracts structured metadata from insurance policy documents. Extract the following fields from this document text.

Respond with JSON only:
{
  "carrier": "insurance company name",
  "policyNumber": "policy number",
  "policyType": one of ["general_liability", "workers_comp", "commercial_auto", "property", "umbrella", "professional_liability", "cyber", "epli", "directors_officers", "other"],
  "policyYear": number (year),
  "effectiveDate": "MM/DD/YYYY",
  "expirationDate": "MM/DD/YYYY",
  "isRenewal": boolean,
  "coverages": [{"name": "coverage name", "limit": "$X,XXX,XXX", "deductible": "$X,XXX"}],
  "premium": "$X,XXX",
  "insuredName": "name of insured party",
  "summary": "1-2 sentence summary of the policy"
}

Document text:
{{text}}`;
