"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGoogle, faMicrosoft, faYahoo } from "@fortawesome/free-brands-svg-icons";
import { Mail } from "lucide-react";

const HOST_ICONS: Record<string, typeof faGoogle> = {
  "imap.gmail.com": faGoogle,
  "outlook.office365.com": faMicrosoft,
  "imap.mail.yahoo.com": faYahoo,
};

export function ConnectionIcon({ imapHost, className = "" }: { imapHost: string; className?: string }) {
  const faIcon = HOST_ICONS[imapHost];
  if (faIcon) {
    return (
      <div className={`rounded-full bg-primary/10 flex items-center justify-center ${className}`}>
        <FontAwesomeIcon icon={faIcon} className="text-primary" style={{ width: 16, height: 16 }} />
      </div>
    );
  }
  return (
    <div className={`rounded-full bg-primary/10 flex items-center justify-center ${className}`}>
      <Mail className="w-4 h-4 text-primary" />
    </div>
  );
}
