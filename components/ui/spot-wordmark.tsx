import { LogoIcon } from "@/components/ui/logo-icon";
import { cn } from "@/lib/utils";
import {
  spotWordmarkLeadingGlyphTypographyStyle,
  redactionTypeStyle,
} from "@/lib/typography";

const SPOT_BLUE = "#A0D2FA";

export function SpotWordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Spot"
      className={cn(
        "inline-flex items-center gap-[0.25em] text-foreground",
        redactionTypeStyle("brand.wordmark"),
        className,
      )}
    >
      <LogoIcon className="shrink-0" size="1em" color={SPOT_BLUE} static />
      <span aria-hidden>
        <span style={spotWordmarkLeadingGlyphTypographyStyle}>s</span>pot
      </span>
    </span>
  );
}
