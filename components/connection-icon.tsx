"use client";

import { FaGoogle, FaMicrosoft, FaYahoo } from "react-icons/fa";
import { Mail } from "lucide-react";
import { type IconType } from "react-icons";

const HOST_ICONS: Record<string, IconType> = {
  "imap.gmail.com": FaGoogle,
  "outlook.office365.com": FaMicrosoft,
  "imap.mail.yahoo.com": FaYahoo,
};

export function ConnectionIcon({ imapHost, className = "" }: { imapHost: string; className?: string }) {
  const Icon = HOST_ICONS[imapHost];
  if (Icon) {
    return (
      <div className={`rounded-full bg-primary/10 flex items-center justify-center ${className}`}>
        <Icon className="text-primary" size={16} />
      </div>
    );
  }
  return (
    <div className={`rounded-full bg-primary/10 flex items-center justify-center ${className}`}>
      <Mail className="w-4 h-4 text-primary" />
    </div>
  );
}
