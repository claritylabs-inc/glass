"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ExtractionsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/connections?tab=processing");
  }, [router]);

  return null;
}
