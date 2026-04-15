"use client";

import { useState, useMemo } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ScanCalendarDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: Id<"emailConnections">;
  provider?: "google" | "imap";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toYMD(d: Date) { return d.toISOString().split("T")[0]; }

export function ScanCalendarDialog({ open, onClose, connectionId, provider }: ScanCalendarDialogProps) {
  const coverage = useQuery(api.emails.dateCoverage, open ? { connectionId } : "skip");
  const scanInbox = useAction(api.actions.scanInbox.scanInbox);
  const scanGmail = useAction(api.actions.scanGmail.scanGmail);

  const today = useMemo(() => toYMD(new Date()), []);
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [pullFrom, setPullFrom] = useState<string | null>(null);

  const coveredDates = useMemo(() => new Set(coverage?.dates ?? []), [coverage]);

  const prev = () => { if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11); } else setViewMonth(viewMonth - 1); };
  const next = () => { if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0); } else setViewMonth(viewMonth + 1); };

  const pullDays = useMemo(() => {
    if (!pullFrom || !coverage?.earliest) return null;
    const d = Math.round((new Date(coverage.earliest).getTime() - new Date(pullFrom).getTime()) / 86400000);
    return d > 0 ? d : null;
  }, [pullFrom, coverage]);

  const handlePull = () => {
    if (!pullFrom) return;
    const fn = provider === "google" ? scanGmail : scanInbox;
    fn({ connectionId, sinceDate: pullFrom, untilDate: coverage?.earliest ?? today })
      .catch(() => toast.error("Failed to start scan"));
    toast.success("Pulling emails...");
    setPullFrom(null);
    onClose();
  };

  function renderMonth(year: number, month: number) {
    const total = new Date(year, month + 1, 0).getDate();
    const offset = new Date(year, month, 1).getDay();
    const cells: React.ReactNode[] = [];

    for (let i = 0; i < offset; i++) cells.push(<div key={`e${i}`} />);

    for (let d = 1; d <= total; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const covered = coveredDates.has(ds);
      const future = ds > today;
      const inPull = pullFrom && ds >= pullFrom && ds < (coverage?.earliest ?? today);
      const isToday = ds === today;

      let cls = "h-7 rounded text-[11px] flex items-center justify-center transition-colors ";
      if (future) cls += "text-foreground/10";
      else if (covered) cls += "bg-foreground/8 text-foreground font-medium";
      else if (inPull) cls += "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium";
      else cls += "text-muted-foreground/40 hover:bg-foreground/[0.05] cursor-pointer";
      if (isToday) cls += " ring-1 ring-foreground/15";

      cells.push(
        <button key={d} type="button" disabled={future || covered}
          onClick={() => { if (!covered && !future) setPullFrom(ds); }}
          className={cls}>{d}</button>
      );
    }
    return cells;
  }

  const pm = viewMonth === 0 ? 11 : viewMonth - 1;
  const py = viewMonth === 0 ? viewYear - 1 : viewYear;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Email Coverage</DialogTitle>
          <DialogDescription>
            {coverage
              ? `${coverage.total} emails across ${coverage.dates.length} days`
              : "Loading coverage..."}
          </DialogDescription>
        </DialogHeader>

        {/* Nav */}
        <div className="flex items-center justify-between -mt-1">
          <button type="button" onClick={prev} className="p-1 rounded hover:bg-foreground/5 cursor-pointer"><ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" /></button>
          <span className="text-label-sm font-medium text-muted-foreground">{MONTHS[pm]} {py} — {MONTHS[viewMonth]} {viewYear}</span>
          <button type="button" onClick={next} className="p-1 rounded hover:bg-foreground/5 cursor-pointer"><ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /></button>
        </div>

        {/* Calendar */}
        <div className="grid grid-cols-2 gap-4">
          {[[py, pm], [viewYear, viewMonth]].map(([y, m], idx) => (
            <div key={idx}>
              <div className="grid grid-cols-7 mb-0.5">
                {DAYS.map((d) => (
                  <div key={`${idx}-${d}`} className="h-5 flex items-center justify-center text-[9px] font-medium text-muted-foreground/40 uppercase">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px">{renderMonth(y, m)}</div>
            </div>
          ))}
        </div>

        {/* Pull action inline */}
        {pullFrom && (
          <div className="flex items-center justify-between rounded-lg bg-foreground/[0.03] border border-foreground/6 px-3 py-2.5">
            <p className="text-body-sm text-foreground">
              Pull from <strong>{pullFrom}</strong>
              {pullDays && <span className="text-muted-foreground/60"> · {pullDays} days</span>}
            </p>
            <PillButton size="compact" onClick={handlePull}>
              <Download className="w-3 h-3" />
              Pull
            </PillButton>
          </div>
        )}

        <DialogFooter>
          <PillButton variant="secondary" onClick={onClose}>Close</PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
