import { redirect } from "next/navigation";

export default function OperatorModelsPage() {
  redirect("/operator/routing?tab=models");
}
