"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PillButton } from "@/components/ui/pill-button";
import { Loader2, Check, X } from "lucide-react";

const AGENT_DOMAIN = process.env.NEXT_PUBLIC_AGENT_DOMAIN ?? "prism.claritylabs.inc";

interface AgentHandleFormProps {
  suggestedHandle?: string;
  onClaimed?: (handle: string) => void;
  claimLabel?: string;
  claimingLabel?: string;
  hideButton?: boolean;
  onAvailabilityChange?: (canClaim: boolean) => void;
  claimRef?: React.MutableRefObject<(() => Promise<void>) | null>;
}

function normalizeHandle(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 30);
}

export function AgentHandleForm({ suggestedHandle, onClaimed, claimLabel = "Claim Handle", claimingLabel = "Claiming...", hideButton, onAvailabilityChange, claimRef }: AgentHandleFormProps) {
  const [input, setInput] = useState("");
  const [debouncedHandle, setDebouncedHandle] = useState("");
  const [claiming, setClaiming] = useState(false);

  const availability = useQuery(
    api.users.checkHandleAvailability,
    debouncedHandle.length >= 3 ? { handle: debouncedHandle } : "skip",
  );
  const claimHandle = useMutation(api.users.claimAgentHandle);

  // Pre-fill from suggestion
  useEffect(() => {
    if (suggestedHandle && !input) {
      setInput(normalizeHandle(suggestedHandle));
    }
  }, [suggestedHandle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce
  useEffect(() => {
    const normalized = normalizeHandle(input);
    const timer = setTimeout(() => setDebouncedHandle(normalized), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const handleClaim = useCallback(async () => {
    if (!availability?.available) return;
    setClaiming(true);
    try {
      const result = await claimHandle({ handle: debouncedHandle });
      onClaimed?.(result);
    } catch (err) {
      console.error("Failed to claim handle:", err);
    } finally {
      setClaiming(false);
    }
  }, [availability, claimHandle, debouncedHandle, onClaimed]);

  // Expose claim function and availability to parent
  useEffect(() => {
    if (claimRef) claimRef.current = handleClaim;
  }, [claimRef, handleClaim]);

  const canClaim = !!availability?.available && !claiming;
  useEffect(() => {
    onAvailabilityChange?.(canClaim);
  }, [canClaim, onAvailabilityChange]);

  const normalized = normalizeHandle(input);
  const isChecking = normalized.length >= 3 && availability === undefined;
  const showStatus = normalized.length >= 3 && !isChecking;

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
        <div className="flex items-stretch gap-0 flex-1 min-w-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="your-handle"
            className="flex-1 min-w-0 rounded-l-lg border border-r-0 border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
          />
          <div className="flex items-center rounded-r-lg border border-l-0 border-foreground/8 bg-foreground/[0.02] px-3 py-2 text-label-sm text-muted-foreground/60 select-none whitespace-nowrap">
            @{AGENT_DOMAIN}
          </div>
        </div>
        {!hideButton && (
          <PillButton
            onClick={handleClaim}
            disabled={!availability?.available || claiming}
            className="w-full sm:w-auto"
          >
            {claiming ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {claimingLabel}
              </>
            ) : (
              claimLabel
            )}
          </PillButton>
        )}
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2 min-h-[20px]">
        {isChecking && (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
            <span className="text-label-sm text-muted-foreground">Checking...</span>
          </>
        )}
        {showStatus && availability?.available && (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-label-sm text-emerald-600">
              {availability.normalized}@{AGENT_DOMAIN} is available
            </span>
          </>
        )}
        {showStatus && !availability?.available && (
          <>
            <X className="w-3.5 h-3.5 text-red-500" />
            <span className="text-label-sm text-red-500">
              {availability?.reason ?? "Not available"}
            </span>
          </>
        )}
        {normalized.length > 0 && normalized.length < 3 && (
          <span className="text-label-sm text-muted-foreground/50">
            Minimum 3 characters
          </span>
        )}
      </div>
    </div>
  );
}
