"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Nav } from "@/components/nav";
import { ExtractionTable } from "@/components/extraction-table";
import { FadeIn } from "@/components/ui/fade-in";

export default function ExtractionsPage() {
  const pending = useQuery(api.policies.listPending, {});

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
          <FadeIn when={true} staggerIndex={0} duration={0.6}>
            <div className="mb-6">
              <h1 className="!mb-1">Extractions</h1>
              <p className="text-body-sm text-muted-foreground">
                Documents being processed from email attachments
              </p>
            </div>
          </FadeIn>

          <ExtractionTable extractions={pending} />
        </div>
      </main>
    </div>
  );
}
