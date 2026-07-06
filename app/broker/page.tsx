import { redirect } from "next/navigation";

export default function BrokerPage() {
  redirect("/settings?section=broker");
}
