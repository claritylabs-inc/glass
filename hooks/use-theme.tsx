"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type ThemeChoice = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeCtx {
  theme: ThemeChoice;
  resolved: ResolvedTheme;
  setTheme: (t: ThemeChoice) => void;
  cycle: () => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: "system",
  resolved: "light",
  setTheme: () => {},
  cycle: () => {},
});

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyClass(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  // Init from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("theme") as ThemeChoice | null;
    const choice = stored === "light" || stored === "dark" ? stored : "system";
    const res = choice === "system" ? getSystemTheme() : choice;
    setThemeState(choice);
    setResolved(res);
    applyClass(res);
  }, []);

  // Listen for OS preference changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      if (theme !== "system") return;
      const res = getSystemTheme();
      setResolved(res);
      applyClass(res);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    const res = t === "system" ? getSystemTheme() : t;
    setResolved(res);
    applyClass(res);
    try {
      if (t === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", t);
    } catch {}
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeChoice =
        prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
      const res = next === "system" ? getSystemTheme() : next;
      setResolved(res);
      applyClass(res);
      try {
        if (next === "system") localStorage.removeItem("theme");
        else localStorage.setItem("theme", next);
      } catch {}
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ theme, resolved, setTheme, cycle: cycleTheme }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme() {
  return useContext(Ctx);
}
