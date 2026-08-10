import { redirect } from "next/navigation";

export default function OperatorToolsPage() {
  redirect("/operator/routing?tab=tools");
}
