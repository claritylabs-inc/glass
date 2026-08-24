import { LogoIcon } from "@/components/ui/logo-icon";
import { cn } from "@/lib/utils";
import {
  glassWordmarkLeadingGlyphTypographyStyle,
  redactionTypeStyle,
} from "@/lib/typography";

const GLASS_BLUE = "#A0D2FA";

export function GlassWordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Glass"
      className={cn(
        "inline-flex items-center gap-1 text-foreground",
        redactionTypeStyle("brand.wordmark"),
        className,
      )}
    >
      <LogoIcon className="shrink-0" size={16} color={GLASS_BLUE} static />
      <span aria-hidden>
        <span style={glassWordmarkLeadingGlyphTypographyStyle}>g</span>lass
      </span>
    </span>
  );
}
