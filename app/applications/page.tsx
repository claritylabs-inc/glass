"use client";

import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { ApplicationsList } from "@/components/applications-list";

export default function ApplicationsPage() {
  return (
    <AppShell>
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <ApplicationsList />
          </FadeIn>
    </AppShell>
  );
}
