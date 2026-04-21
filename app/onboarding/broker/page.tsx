// app/onboarding/broker/page.tsx
"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = "name" | "slug" | "branding" | "handle" | "done";

export default function BrokerOnboardingPage() {
  const router = useRouter();
  const createBrokerOrg = useMutation(api.orgs.createBrokerOrg);

  const [step, setStep] = useState<Step>("name");
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [brandingColor, setBrandingColor] = useState("#4F46E5");
  const [agentDisplayName, setAgentDisplayName] = useState("");
  const [agentHandle, setAgentHandle] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const slugCheck = useQuery(
    api.orgs.checkSlugAvailability,
    slugInput.length >= 3 ? { slug: slugInput } : "skip",
  );

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      await createBrokerOrg({
        name: orgName.trim(),
        website: website.trim() || undefined,
        slug: slugInput.trim(),
        brandingColor: brandingColor || undefined,
        agentDisplayName: agentDisplayName.trim() || undefined,
        agentHandle: agentHandle.trim() || undefined,
      });
      router.push("/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create org");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full px-6 py-8 bg-white rounded-2xl shadow-sm border border-gray-100">
        <h1 className="text-xl font-semibold text-gray-900 mb-6">Set up your brokerage</h1>

        {step === "name" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Brokerage name</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Insurance Brokers"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Website (optional)</label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://acme-brokers.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={() => setStep("slug")}
              disabled={!orgName.trim()}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {step === "slug" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Your Glass URL slug
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">glass.app/</span>
                <input
                  type="text"
                  value={slugInput}
                  onChange={(e) => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="acme-brokers"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {slugInput.length >= 3 && slugCheck && (
                <p className={`text-xs mt-1 ${slugCheck.available ? "text-green-600" : "text-red-600"}`}>
                  {slugCheck.available ? "Available" : slugCheck.reason}
                </p>
              )}
            </div>
            <button
              onClick={() => setStep("branding")}
              disabled={!slugCheck?.available}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {step === "branding" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Agent display name
              </label>
              <input
                type="text"
                value={agentDisplayName}
                onChange={(e) => setAgentDisplayName(e.target.value)}
                placeholder="Acme Agent"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Accent color</label>
              <input
                type="color"
                value={brandingColor}
                onChange={(e) => setBrandingColor(e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border border-gray-300"
              />
            </div>
            <button
              onClick={() => setStep("handle")}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg"
            >
              Continue
            </button>
          </div>
        )}

        {step === "handle" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Agent handle (optional)
              </label>
              <input
                type="text"
                value={agentHandle}
                onChange={(e) => setAgentHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="acme"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {submitting ? "Creating brokerage…" : "Finish setup"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
