import {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  LEGACY_ACORD_LOB_CODE_TO_CURRENT,
  LEGACY_POLICY_TYPE_TO_LOB,
  isLobCode,
  isPersonalLob,
  lobLabel,
  toLobCodes,
  type AcordLobCode,
} from "@claritylabs/cl-sdk/policy-taxonomy";

export {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  LEGACY_ACORD_LOB_CODE_TO_CURRENT,
  LEGACY_POLICY_TYPE_TO_LOB,
  isLobCode,
  lobLabel,
  toLobCodes,
};
export type { AcordLobCode };

const LOB_BADGE_COLORS: Partial<Record<AcordLobCode, string>> = {
  CGL: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  PROP: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  AUTOB: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  AUTOP: "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
  GARAG: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  TRUCK: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  WORK: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  WCMA: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  WORKP: "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
  WORKV: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  UMBRC: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  UMBRL: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  UMBRP: "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
  EXLIA: "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
  EO: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  PL: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  OLIB: "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
  CYBER: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  EPLI: "bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400",
  DO: "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
  FIDUC: "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
  CRIM: "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
  CRIME: "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
  INMAR: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  INMRC: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  INMRP: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
  COMR: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  SURE: "bg-stone-100 dark:bg-stone-950/40 text-stone-700 dark:text-stone-400",
  BOP: "bg-slate-100 dark:bg-slate-950/40 text-slate-700 dark:text-slate-400",
  HOME: "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
  DFIRE: "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400",
  FLOOD: "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
  EQ: "bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400",
  BOAT: "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
  RECV: "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
  CFRM: "bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400",
  DISAB: "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
  TRVL: "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
};

export function lobBadgeClass(code: string): string {
  const [normalized] = toLobCodes([code]);
  return normalized && LOB_BADGE_COLORS[normalized]
    ? LOB_BADGE_COLORS[normalized]
    : "bg-gray-100 dark:bg-gray-800/40 text-gray-700 dark:text-gray-400";
}

export function policyLobCodes(policy: {
  linesOfBusiness?: readonly string[];
}): AcordLobCode[] {
  return toLobCodes(policy.linesOfBusiness);
}

export function lobSearchTerms(values?: readonly string[]): string[] {
  const codes = toLobCodes(values);
  return Array.from(
    new Set(
      codes.flatMap((code) => [
        code,
        code.toLowerCase(),
        ACORD_LOB_LABELS[code],
        ACORD_LOB_LABELS[code].toLowerCase(),
      ]),
    ),
  );
}

export { isPersonalLob };
