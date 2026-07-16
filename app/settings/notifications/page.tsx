import { redirect } from "next/navigation";

export default function NotificationSettingsRoute() {
  redirect("/settings?section=workflows&tab=notifications");
}
