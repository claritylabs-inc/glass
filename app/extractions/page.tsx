import { redirect } from "next/navigation";
export default function ExtractionsPage() {
  redirect("/settings?section=activity");
}
