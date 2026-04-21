import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

type IntentRow = {
  intentKey: string;
  label: string;
  defaultPrompt: string;
  answerType: string;
  category: string;
  passportFieldPath?: string;
  integrationCandidates?: string[];
  selectOptions?: { value: string; label: string }[];
  validationHint?: string;
};

const INTENTS: IntentRow[] = [
  // --- Applicant Info ---
  { intentKey: "legal_name", label: "Legal Name", defaultPrompt: "What is the full legal name of your organization?", answerType: "text", category: "applicant_info", passportFieldPath: "profile.name" },
  { intentKey: "dba_name", label: "DBA Name", defaultPrompt: "Does your organization operate under a DBA? If so, what is it?", answerType: "text", category: "applicant_info" },
  { intentKey: "mailing_address", label: "Mailing Address", defaultPrompt: "What is your organization's primary mailing address?", answerType: "address", category: "applicant_info", passportFieldPath: "profile.mailingAddress" },
  { intentKey: "years_in_business", label: "Years in Business", defaultPrompt: "How many years has your organization been in business?", answerType: "number", category: "applicant_info" },
  { intentKey: "entity_type", label: "Entity Type", defaultPrompt: "What is your organization's legal entity type?", answerType: "select", category: "applicant_info", selectOptions: [{ value: "corporation", label: "Corporation" }, { value: "llc", label: "LLC" }, { value: "partnership", label: "Partnership" }, { value: "sole_prop", label: "Sole Proprietorship" }, { value: "nonprofit", label: "Nonprofit" }, { value: "other", label: "Other" }] },
  { intentKey: "fein", label: "FEIN", defaultPrompt: "What is your Federal Employer Identification Number (FEIN)?", answerType: "text", category: "applicant_info", validationHint: "9-digit number, format XX-XXXXXXX" },
  { intentKey: "website", label: "Website", defaultPrompt: "What is your organization's primary website?", answerType: "text", category: "applicant_info", passportFieldPath: "profile.website" },

  // --- Operations ---
  { intentKey: "description_of_operations", label: "Description of Operations", defaultPrompt: "Please describe your organization's primary business operations.", answerType: "long_text", category: "operations", passportFieldPath: "profile.context" },
  { intentKey: "number_of_employees_full_time", label: "Full-Time Employees", defaultPrompt: "How many full-time employees does your organization have?", answerType: "number", category: "operations", passportFieldPath: "workforce.fullTimeCount", integrationCandidates: ["quickbooks:employee_count", "gusto:employee_count"] },
  { intentKey: "number_of_employees_part_time", label: "Part-Time Employees", defaultPrompt: "How many part-time employees does your organization have?", answerType: "number", category: "operations" },
  { intentKey: "locations_list", label: "Locations", defaultPrompt: "Please provide details for each of your business locations.", answerType: "location_list", category: "operations" },
  { intentKey: "subsidiaries_list", label: "Subsidiaries", defaultPrompt: "Does your organization have any subsidiaries or affiliated entities?", answerType: "subsidiary_list", category: "operations" },
  { intentKey: "states_of_operation", label: "States of Operation", defaultPrompt: "In which U.S. states does your organization conduct business?", answerType: "multi_select", category: "operations" },

  // --- Financial ---
  { intentKey: "annual_revenue", label: "Annual Revenue", defaultPrompt: "What was your organization's gross annual revenue for the most recently completed fiscal year?", answerType: "currency", category: "financial", passportFieldPath: "financials.annualRevenue", integrationCandidates: ["quickbooks:revenue"] },
  { intentKey: "annual_payroll", label: "Annual Payroll", defaultPrompt: "What is your total annual payroll?", answerType: "currency", category: "financial", integrationCandidates: ["quickbooks:payroll", "gusto:payroll"] },
  { intentKey: "total_assets", label: "Total Assets", defaultPrompt: "What are your organization's total assets?", answerType: "currency", category: "financial", integrationCandidates: ["quickbooks:total_assets"] },
  { intentKey: "fiscal_year_end", label: "Fiscal Year End", defaultPrompt: "What month does your fiscal year end?", answerType: "select", category: "financial", selectOptions: [{ value: "01", label: "January" }, { value: "02", label: "February" }, { value: "03", label: "March" }, { value: "04", label: "April" }, { value: "05", label: "May" }, { value: "06", label: "June" }, { value: "07", label: "July" }, { value: "08", label: "August" }, { value: "09", label: "September" }, { value: "10", label: "October" }, { value: "11", label: "November" }, { value: "12", label: "December" }] },

  // --- History ---
  { intentKey: "prior_losses_5yr", label: "Prior Losses (5yr)", defaultPrompt: "Please describe any insurance claims or losses your organization has had in the past 5 years.", answerType: "loss_list", category: "history" },
  { intentKey: "prior_cancellations", label: "Prior Cancellations or Non-Renewals", defaultPrompt: "Has your organization ever had an insurance policy cancelled or non-renewed in the past 3 years?", answerType: "yes_no", category: "history" },
  { intentKey: "prior_cancellations_explanation", label: "Cancellation Explanation", defaultPrompt: "Please explain the reason for the cancellation or non-renewal.", answerType: "long_text", category: "history" },

  // --- Coverage Preferences ---
  { intentKey: "desired_effective_date", label: "Desired Effective Date", defaultPrompt: "What is your desired policy effective date?", answerType: "date", category: "coverage_preferences" },
  { intentKey: "current_carrier", label: "Current Carrier", defaultPrompt: "Who is your current insurance carrier for this line of business?", answerType: "text", category: "coverage_preferences" },
  { intentKey: "current_premium", label: "Current Premium", defaultPrompt: "What is your current annual premium for this line of business?", answerType: "currency", category: "coverage_preferences" },
  { intentKey: "desired_limits", label: "Desired Coverage Limits", defaultPrompt: "What coverage limits are you seeking?", answerType: "text", category: "coverage_preferences" },

  // --- Supporting Docs ---
  { intentKey: "loss_runs_upload", label: "Loss Runs", defaultPrompt: "Please upload your loss runs for the past 5 years.", answerType: "file_upload", category: "supporting_docs" },
  { intentKey: "financial_statements_upload", label: "Financial Statements", defaultPrompt: "Please upload your most recent financial statements.", answerType: "file_upload", category: "supporting_docs" },

  // --- CGL-specific (ACORD 126) ---
  { intentKey: "premises_operations", label: "Premises Operations Description", defaultPrompt: "Describe the nature of your premises and operations.", answerType: "long_text", category: "operations" },
  { intentKey: "subcontractors_used", label: "Subcontractors Used", defaultPrompt: "Does your organization use subcontractors?", answerType: "yes_no", category: "operations" },
  { intentKey: "subcontractor_annual_cost", label: "Annual Subcontractor Cost", defaultPrompt: "What is the total annual cost of subcontracted work?", answerType: "currency", category: "financial" },

  // --- Property-specific (ACORD 140) ---
  { intentKey: "building_construction_type", label: "Building Construction Type", defaultPrompt: "What is the construction type of your primary building?", answerType: "select", category: "risk", selectOptions: [{ value: "frame", label: "Frame" }, { value: "joisted_masonry", label: "Joisted Masonry" }, { value: "non_combustible", label: "Non-Combustible" }, { value: "masonry_non_combustible", label: "Masonry Non-Combustible" }, { value: "modified_fire_resistive", label: "Modified Fire Resistive" }, { value: "fire_resistive", label: "Fire Resistive" }] },
  { intentKey: "building_year_built", label: "Year Built", defaultPrompt: "What year was the primary building constructed?", answerType: "number", category: "risk" },
  { intentKey: "building_replacement_cost", label: "Building Replacement Cost", defaultPrompt: "What is the estimated replacement cost of the building?", answerType: "currency", category: "risk" },
  { intentKey: "sprinkler_system", label: "Sprinkler System", defaultPrompt: "Does the building have an automatic sprinkler system?", answerType: "yes_no", category: "risk" },
];

export const seedQuestionIntents = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const intent of INTENTS) {
      await ctx.runMutation((internal as any).questionIntents.upsertInternal, intent);
    }
    return { seeded: INTENTS.length };
  },
});
