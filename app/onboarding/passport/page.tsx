import { redirect } from "next/navigation";

// This server component just redirects to the first step.
// Step-level routing is handled by the child pages.
// The client shell route guard (added in Task 12) redirects here when coreCompletedAt is unset.
export default function PassportOnboardingIndexPage() {
  redirect("/onboarding/passport/welcome");
}
