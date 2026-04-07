import { redirect } from "next/navigation";

export default function QuotesRedirect() {
  redirect("/policies?view=quotes");
}
