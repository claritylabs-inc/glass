"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { X, Server, ArrowLeft, Mail, Clock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { PillButton } from "@/components/ui/pill-button";
import { FaGoogle, FaMicrosoft, FaYahoo } from "react-icons/fa";
import { type ReactNode } from "react";

const IMAP_PRESETS: Record<string, { host: string; port: number; icon: ReactNode }> = {
  Outlook: { host: "outlook.office365.com", port: 993, icon: <FaMicrosoft size={16} /> },
  Yahoo: { host: "imap.mail.yahoo.com", port: 993, icon: <FaYahoo size={16} /> },
  Custom: { host: "", port: 993, icon: <Server className="w-4 h-4" /> },
};

const HISTORY_OPTIONS = [
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
] as const;

type Step = "choose" | "history" | "imap";
type ProviderChoice = "google" | "imap";

interface ConnectionFormProps {
  open: boolean;
  onClose: () => void;
  orgId?: string;
}

export function ConnectionForm({ open, onClose, orgId }: ConnectionFormProps) {
  const createConnection = useMutation(api.connections.create);
  const [step, setStep] = useState<Step>("choose");
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>("google");
  const [historyDays, setHistoryDays] = useState(30);
  const [preset, setPreset] = useState("Outlook");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState(IMAP_PRESETS.Outlook.host);
  const [port, setPort] = useState(IMAP_PRESETS.Outlook.port);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handlePresetChange = (p: string) => {
    setPreset(p);
    if (IMAP_PRESETS[p]) {
      setHost(IMAP_PRESETS[p].host);
      setPort(IMAP_PRESETS[p].port);
    }
  };

  const handleClose = () => {
    onClose();
    setStep("choose");
  };

  const handleChooseProvider = (provider: ProviderChoice) => {
    setProviderChoice(provider);
    setStep("history");
  };

  const handleHistoryConfirm = () => {
    if (providerChoice === "google") {
      // Redirect to Google OAuth with history days encoded
      const sinceDate = new Date(Date.now() - historyDays * 86400000).toISOString().split("T")[0];
      const params = new URLSearchParams();
      if (orgId) params.set("orgId", orgId);
      params.set("sinceDate", sinceDate);
      window.location.href = `/api/auth/google/start?${params.toString()}`;
    } else {
      setStep("imap");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createConnection({
        label: label || email,
        imapHost: host,
        imapPort: port,
        email,
        password,
      });
      handleClose();
      setLabel("");
      setEmail("");
      setPassword("");
      toast.success("Connection added");
    } catch {
      toast.error("Failed to add connection");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 backdrop-blur-sm"
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative bg-popover rounded-xl border border-foreground/8 shadow-xl max-w-md w-full mx-4 p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="!mb-0">Add Email Connection</h3>
              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <AnimatePresence mode="wait">
              {/* Step 1: Choose provider */}
              {step === "choose" && (
                <motion.div
                  key="choose"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-3"
                >
                  <button
                    type="button"
                    onClick={() => handleChooseProvider("google")}
                    className="flex items-center gap-3 w-full px-4 py-3.5 rounded-lg bg-foreground text-background font-medium text-body-sm shadow-sm hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <FaGoogle size={18} />
                    Connect Google
                  </button>
                  <button
                    type="button"
                    onClick={() => handleChooseProvider("imap")}
                    className="flex items-center gap-3 w-full px-4 py-3.5 rounded-lg border border-foreground/8 bg-popover text-foreground font-medium text-body-sm hover:border-foreground/15 hover:bg-foreground/[0.02] transition-all cursor-pointer"
                  >
                    <Mail className="w-[18px] h-[18px]" />
                    Other email provider
                  </button>
                </motion.div>
              )}

              {/* Step 2: Choose history range */}
              {step === "history" && (
                <motion.div
                  key="history"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider">
                        Email history to import
                      </label>
                    </div>
                    <p className="text-label-sm text-muted-foreground/50 mb-3">
                      Prism will scan this period for policies and business intelligence. You can always pull more later.
                    </p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {HISTORY_OPTIONS.map((opt) => {
                        const isActive = historyDays === opt.days;
                        return (
                          <button
                            key={opt.days}
                            type="button"
                            onClick={() => setHistoryDays(opt.days)}
                            className={`px-2 py-2 rounded-lg text-label-sm font-medium transition-all cursor-pointer text-center ${
                              isActive
                                ? "bg-foreground text-background shadow-sm"
                                : "border border-foreground/8 bg-popover text-muted-foreground hover:border-foreground/15 hover:text-foreground"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-between gap-3 pt-2">
                    <PillButton
                      variant="secondary"
                      onClick={() => setStep("choose")}
                      type="button"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      Back
                    </PillButton>
                    <PillButton onClick={handleHistoryConfirm}>
                      Continue
                    </PillButton>
                  </div>
                </motion.div>
              )}

              {/* Step 3: IMAP form (only for non-Google) */}
              {step === "imap" && (
                <motion.div
                  key="imap"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                >
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-2">
                        Provider
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(IMAP_PRESETS).map(([p, config]) => {
                          const isActive = preset === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => handlePresetChange(p)}
                              className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg text-label-sm font-medium transition-all cursor-pointer ${
                                isActive
                                  ? "bg-foreground text-background shadow-sm"
                                  : "border border-foreground/8 bg-popover text-muted-foreground hover:border-foreground/15 hover:text-foreground hover:bg-foreground/[0.02]"
                              }`}
                            >
                              {config.icon}
                              {p}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Label (optional)
                      </label>
                      <input
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="e.g. Business Email"
                        className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>

                    {preset === "Custom" && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                            IMAP Host
                          </label>
                          <input
                            type="text"
                            value={host}
                            onChange={(e) => setHost(e.target.value)}
                            required
                            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                            Port
                          </label>
                          <input
                            type="number"
                            value={port}
                            onChange={(e) => setPort(Number(e.target.value))}
                            required
                            className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder="you@example.com"
                        className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>

                    <div>
                      <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-1.5">
                        Password / App Password
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        placeholder="App-specific password"
                        className="w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                      />
                    </div>

                    <div className="flex justify-between gap-3 pt-3">
                      <PillButton
                        variant="secondary"
                        onClick={() => setStep("history")}
                        type="button"
                      >
                        <ArrowLeft className="w-3 h-3" />
                        Back
                      </PillButton>
                      <div className="flex gap-3">
                        <PillButton variant="secondary" onClick={handleClose} type="button">
                          Cancel
                        </PillButton>
                        <PillButton type="submit" disabled={saving}>
                          {saving ? "Saving..." : "Add Connection"}
                        </PillButton>
                      </div>
                    </div>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
