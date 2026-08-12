"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { type ThemeChoice, useTheme } from "@/hooks/use-theme";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

const MODES: Array<{
  mode: ThemeChoice;
  label: string;
  ariaLabel: string;
  icon: LucideIcon;
}> = [
  {
    mode: "light",
    label: "Light",
    ariaLabel: "Use light theme",
    icon: Sun,
  },
  {
    mode: "dark",
    label: "Dark",
    ariaLabel: "Use dark theme",
    icon: Moon,
  },
  {
    mode: "system",
    label: "System",
    ariaLabel: "Use system theme",
    icon: Monitor,
  },
];

export function ThemeModeSelector({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={cn("grid w-full grid-cols-3 gap-2", className)}
    >
      {MODES.map(({ mode, label, ariaLabel, icon: Icon }) => {
        const selected = theme === mode;

        return (
          <button
            key={mode}
            type="button"
            aria-label={ariaLabel}
            aria-pressed={selected}
            title={ariaLabel}
            onClick={() => setTheme(mode)}
            className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-3 py-2 outline-none transition-[background-color,color,transform] duration-100 ease-out active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-foreground/20 motion-reduce:transform-none motion-reduce:transition-none ${typeStyle("control.button")} ${
              selected
                ? "bg-foreground/[0.07] text-foreground"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
