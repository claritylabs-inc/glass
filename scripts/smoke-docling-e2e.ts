#!/usr/bin/env tsx

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

async function main() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
  const filePath = process.env.DOCLING_SMOKE_PDF || "~/Desktop/specimen_policy.pdf";
  const orgId = process.env.DOCLING_SMOKE_ORG_ID as Id<"organizations"> | undefined;

  if (!convexUrl) throw new Error("Set NEXT_PUBLIC_CONVEX_URL or CONVEX_URL");
  if (!orgId) throw new Error("Set DOCLING_SMOKE_ORG_ID to the single org being smoke-tested");

  console.log("Docling smoke test configuration:");
  console.log(`orgId: ${orgId}`);
  console.log(`pdf: ${filePath}`);
  console.log("Enable organizations.featureFlags.docling=true for this org, upload the specimen through the app or API, then inspect the resulting policyFiles row.");

  // Keep the client import exercised so this script fails early if generated API wiring is broken.
  const client = new ConvexHttpClient(convexUrl);
  void client;
  void api;

  console.log("Expected parser metadata after extraction:");
  console.log("parserBackend: docling");
  console.log("parserVersion: docling-...");
  console.log("parsedMarkdown length: >50000");
  console.log("Specimen check: Coverage Part A = $2M / $2M Aggregate");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
