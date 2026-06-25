type MissingQuestion = {
  fieldId: string;
  label: string;
  section?: string;
  prompt: string;
  required: boolean;
};

export type ApplicationIntakeStartIntent = {
  title: string;
  applicationType?: string;
  lineOfBusiness?: string;
  product?: string;
  requestText: string;
  missingQuestions: MissingQuestion[];
};

const CHANGE_OR_DELIVERY_PATTERN =
  /\b(add|remove|update|change|endorse|endorsement|additional insured|named insured|waiver|certificate|coi|send|email|attach|copy|details|summary|pdf)\b/;
const STRONG_START_PATTERN =
  /\b(apply|application|quote|quotes|submission|submit|renew|renewal)\b/;
const NEW_START_PATTERN = /\bnew\b/;
const INSURANCE_CONTEXT_PATTERN =
  /\b(insurance|policy|coverage|carrier|broker|commercial auto|business auto|workers'? comp|workers compensation|general liability|cyber|e&o|errors and omissions|professional liability|umbrella|excess|property)\b/;

function normalize(value: string) {
  return value.toLowerCase().replace(/[’']/g, "'");
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectLineOfBusiness(text: string) {
  if (/\b(commercial|business)\s+auto\b|\bauto\s+(policy|insurance|quote|application)\b|\bvehicle(s)?\b/.test(text)) {
    return "commercial auto";
  }
  if (/\b(workers'? comp|workers compensation|wc)\b/.test(text)) {
    return "workers comp";
  }
  if (/\b(general liability|commercial general liability|cgl)\b/.test(text)) {
    return "general liability";
  }
  if (/\b(cyber|technology professional|network security|privacy liability)\b/.test(text)) {
    return "cyber";
  }
  if (/\b(e&o|errors and omissions|professional liability)\b/.test(text)) {
    return "professional liability";
  }
  if (/\b(umbrella|excess)\b/.test(text)) {
    return "umbrella";
  }
  if (/\b(property|bop|business owner'?s policy)\b/.test(text)) {
    return "property";
  }
  return undefined;
}

function missingQuestionsFor(lineOfBusiness?: string): MissingQuestion[] {
  const questions: MissingQuestion[] = [];
  if (!lineOfBusiness) {
    questions.push({
      fieldId: "line_of_business",
      label: "Line of business",
      section: "Application",
      prompt: "What line of coverage should this application cover?",
      required: true,
    });
  }

  if (lineOfBusiness === "commercial auto") {
    questions.push(
      {
        fieldId: "coverage_goal",
        label: "Coverage goal",
        section: "Commercial auto",
        prompt: "What coverage do you need: owned autos only, hired/non-owned auto, or another commercial auto setup?",
        required: true,
      },
      {
        fieldId: "vehicle_schedule",
        label: "Vehicles",
        section: "Commercial auto",
        prompt: "What vehicles should be included? Send count, type, VINs if available, and garaging city/state.",
        required: true,
      },
      {
        fieldId: "driver_information",
        label: "Drivers",
        section: "Commercial auto",
        prompt: "Who will drive them, and are the drivers employees, contractors, owners, or another group?",
        required: true,
      },
      {
        fieldId: "target_effective_date",
        label: "Target effective date",
        section: "Application",
        prompt: "What effective date should we target?",
        required: true,
      },
    );
    return questions;
  }

  questions.push(
    {
      fieldId: "coverage_goal",
      label: "Coverage goal",
      section: "Application",
      prompt: "What coverage goal or limits should the application target?",
      required: true,
    },
    {
      fieldId: "target_effective_date",
      label: "Target effective date",
      section: "Application",
      prompt: "What effective date should we target?",
      required: true,
    },
  );
  return questions;
}

export function resolveApplicationIntakeStartIntent(
  messageText: string,
): ApplicationIntakeStartIntent | null {
  const requestText = messageText.trim();
  if (!requestText || requestText.startsWith("/") || requestText.length > 500) {
    return null;
  }

  const text = normalize(requestText);
  const lineOfBusiness = detectLineOfBusiness(text);
  const hasStrongStartLanguage = STRONG_START_PATTERN.test(text);
  const hasNewStartLanguage = NEW_START_PATTERN.test(text);
  const hasStartLanguage = hasStrongStartLanguage || hasNewStartLanguage;
  const hasInsuranceContext = INSURANCE_CONTEXT_PATTERN.test(text) || Boolean(lineOfBusiness);
  if (!hasStartLanguage || !hasInsuranceContext) return null;

  const looksLikePolicyChange = CHANGE_OR_DELIVERY_PATTERN.test(text)
    && !hasStrongStartLanguage;
  if (looksLikePolicyChange) return null;

  const displayLine = lineOfBusiness ? titleCase(lineOfBusiness) : "Insurance";
  return {
    title: `${displayLine} Application`,
    applicationType: lineOfBusiness,
    lineOfBusiness,
    requestText,
    missingQuestions: missingQuestionsFor(lineOfBusiness),
  };
}
