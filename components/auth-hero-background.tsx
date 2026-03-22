import Image from "next/image";
import { LogoIcon } from "@/components/ui/logo-icon";

/**
 * Full-screen hero background for auth pages.
 * Blurred city photo + dot matrix overlay + white PRISM logo.
 */
export function AuthHeroBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Blurred photo */}
      <Image
        src="/sf-hero.webp"
        alt=""
        fill
        className="object-cover scale-105 blur-[8px]"
        sizes="100vw"
        priority
      />

      {/* Dot matrix overlay — opacity increases downward for depth */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMid slice"
      >
        {(() => {
          const dots: React.ReactElement[] = [];
          const spacing = 14;
          for (let row = 0; row * spacing < 400; row++) {
            const y = row * spacing;
            const t = y / 400;
            const opacity = 0.05 + t * 0.55;
            const r = 0.5 + t * 0.5;
            for (let col = 0; col * spacing < 800; col++) {
              dots.push(
                <circle
                  key={`${row}-${col}`}
                  cx={col * spacing}
                  cy={y}
                  r={r}
                  fill={`rgba(255,255,255,${opacity})`}
                />
              );
            }
          }
          return dots;
        })()}
      </svg>
    </div>
  );
}

/** White PRISM logo for use on hero backgrounds */
export function PrismHeroLogo() {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      <span
        className="font-normal text-white uppercase inline-flex items-center gap-3 serif"
        style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", letterSpacing: "-0.03em" }}
      >
        <LogoIcon size={40} color="#ffffff" static className="shrink-0" />
        Prism
      </span>
    </div>
  );
}
