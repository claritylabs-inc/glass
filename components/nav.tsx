"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FileText, Mail } from "lucide-react";
import { LogoIcon } from "@/components/ui/logo-icon";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/policies", label: "Policies", icon: FileText },
  { href: "/connections", label: "Connections", icon: Mail },
];

export function Nav() {
  const pathname = usePathname();

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
      </div>
    </nav>
  );
}
