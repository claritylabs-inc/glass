"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { LayoutDashboard, FileText, Mail, FileSearch, Menu, X, LogOut, Settings } from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";
import { AnimatePresence, motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/extractions", label: "Extractions", icon: FileSearch },
  { href: "/policies", label: "Policies", icon: FileText },
  { href: "/connections", label: "Connections", icon: Mail },
];

export function Nav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const viewer = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const initials = viewer?.name
    ? viewer.name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : viewer?.email
      ? viewer.email[0].toUpperCase()
      : "?";

  return (
    <nav className="sticky top-0 z-50 shrink-0 border-b border-foreground/6 bg-white/60 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 md:px-8 flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center">
            <LogoIcon size={22} className="shrink-0" />
          </Link>
          <div className="hidden sm:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-body-sm font-medium transition-colors ${
                    isActive
                      ? "text-foreground bg-foreground/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/3"
                  }`}
                >
                  <item.icon className="w-3.5 h-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* User menu */}
          {viewer && (
            <DropdownMenu>
              <DropdownMenuTrigger openOnHover delay={150} closeDelay={300} className="flex items-center justify-center w-8 h-8 rounded-full bg-foreground/8 text-label-sm font-medium text-foreground hover:bg-foreground/12 transition-colors cursor-pointer outline-none select-none">
                {viewer.image ? (
                  <img
                    src={viewer.image}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  initials
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="min-w-[200px]">
                <div className="px-2 py-2">
                  <p className="text-body-sm font-medium text-foreground truncate">
                    {viewer.name || viewer.email}
                  </p>
                  {viewer.name && viewer.email && (
                    <p className="text-label-sm text-muted-foreground truncate">
                      {viewer.email}
                    </p>
                  )}
                </div>
                <DropdownMenuSeparator />
                <Link href="/profile">
                  <DropdownMenuItem className="cursor-pointer gap-2">
                    <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                    Profile
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuItem
                  className="cursor-pointer gap-2"
                  onClick={() => signOut()}
                >
                  <LogOut className="w-3.5 h-3.5 text-muted-foreground" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="sm:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 top-14 bg-black/20 z-40 sm:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: "auto" }}
              exit={{ height: 0 }}
              transition={{ duration: 0.2 }}
              className="sm:hidden overflow-hidden border-t border-foreground/6 bg-white relative z-50"
            >
              <div className="px-4 py-2 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-body-sm font-medium transition-colors ${
                        isActive
                          ? "text-foreground bg-foreground/5"
                          : "text-muted-foreground hover:text-foreground hover:bg-foreground/3"
                      }`}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </nav>
  );
}
