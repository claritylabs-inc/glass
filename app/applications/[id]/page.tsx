"use client";

import { use } from "react";
import { redirect } from "next/navigation";

/**
 * Legacy applicationSessions route — retired.
 * Redirects to the applications v2 route at /applications/[applicationId].
 * If the ID happens to be a valid v2 application, the redirect will work.
 * Otherwise the v2 page will show not-found.
 */
export default function LegacyApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  redirect(`/applications/${id}`);
}
