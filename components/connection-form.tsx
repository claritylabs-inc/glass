"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { X, Mail, Globe, AtSign, Server } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const PRESETS: Record<string, { host: string; port: number; icon: typeof Mail }> = {
  Gmail: { host: "imap.gmail.com", port: 993, icon: Mail },
  Outlook: { host: "outlook.office365.com", port: 993, icon: Globe },
  Yahoo: { host: "imap.mail.yahoo.com", port: 993, icon: AtSign },
  Custom: { host: "", port: 993, icon: Server },
};

interface ConnectionFormProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectionForm({ open, onClose }: ConnectionFormProps) {
  const createConnection = useMutation(api.connections.create);
  const [preset, setPreset] = useState("Gmail");
  const [label, setLabel] = useState("");
  const [host, setHost] = useState(PRESETS.Gmail.host);
  const [port, setPort] = useState(PRESETS.Gmail.port);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handlePresetChange = (p: string) => {
    setPreset(p);
    if (PRESETS[p]) {
      setHost(PRESETS[p].host);
      setPort(PRESETS[p].port);
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
      onClose();
      setLabel("");
      setEmail("");
      setPassword("");
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
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="relative bg-white rounded-xl border border-foreground/8 shadow-xl max-w-md w-full mx-4 p-6"
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="!mb-0">Add Email Connection</h3>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-foreground/5 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-label-sm font-medium text-muted-foreground uppercase tracking-wider block mb-2">
                  Provider
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(PRESETS).map(([p, config]) => {
                    const Icon = config.icon;
                    const isActive = preset === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handlePresetChange(p)}
                        className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg text-label-sm font-medium transition-all cursor-pointer ${
                          isActive
                            ? "bg-foreground text-background shadow-sm"
                            : "border border-foreground/8 bg-white text-muted-foreground hover:border-foreground/15 hover:text-foreground hover:bg-foreground/[0.02]"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
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
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
                      className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
                      className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
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
                  className="w-full rounded-lg border border-foreground/8 bg-white px-3 py-2 text-body-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 focus:ring-1 focus:ring-foreground/8 transition-colors"
                />
                {preset === "Gmail" && (
                  <p className="text-label-sm text-muted-foreground/50 mt-1.5">
                    Gmail requires an App Password. Enable 2FA, then generate one at
                    myaccount.google.com/apppasswords
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-full border border-foreground/8 bg-white text-label font-medium text-muted-foreground hover:text-foreground hover:border-foreground/15 hover:bg-foreground/[0.02] transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <motion.button
                  type="submit"
                  disabled={saving}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="px-5 py-2 rounded-full bg-foreground text-background text-label font-medium shadow-sm hover:shadow-md transition-shadow disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Saving..." : "Add Connection"}
                </motion.button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
