"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function SidebarHeader({
  collapsed,
  headerOrgIcon,
  viewerImage,
  initials,
  headerOrgName,
  onToggleCollapse,
  backHref,
  icon,
}: {
  collapsed: boolean;
  headerOrgIcon?: string | null;
  viewerImage?: string | null;
  initials: string;
  headerOrgName: string;
  onToggleCollapse: () => void;
  backHref?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 h-12 border-b border-foreground/6">
      {!collapsed && backHref ? (
        <Link
          href={backHref}
          className="flex items-center gap-1.5 text-body-sm text-muted-foreground hover:text-foreground transition-colors flex-1 min-w-0"
        >
          <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
          <span>Back</span>
        </Link>
      ) : null}

      {!collapsed && !backHref ? (
        <>
          <div
            className={`ml-0.5 w-7 h-7 bg-foreground/8 flex items-center justify-center text-label-sm font-medium text-foreground shrink-0 overflow-hidden ${headerOrgIcon ? "rounded-md" : "rounded-full"}`}
          >
            {headerOrgIcon ? (
              <Image
                src={headerOrgIcon}
                alt=""
                width={28}
                height={28}
                unoptimized
                className="w-7 h-7 object-contain bg-white"
              />
            ) : viewerImage ? (
              <Image
                src={viewerImage}
                alt=""
                width={28}
                height={28}
                unoptimized
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : icon ? (
              icon
            ) : (
              initials
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-medium text-foreground truncate">
              {headerOrgName}
            </p>
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={onToggleCollapse}
        className="w-7 h-7 hidden lg:flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0"
      >
        {collapsed ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}
