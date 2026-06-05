"use client";

import { cn } from "@/lib/utils";

const sizeClasses = {
  xs: "h-3.5 w-3.5",
  sm: "h-6 w-6",
  md: "h-7 w-7",
  lg: "h-8 w-8",
} as const;

const imagePaddingClasses = {
  xs: "p-0",
  sm: "p-0",
  md: "p-0",
  lg: "p-0",
} as const;

type BrandIconProps = {
  src?: string | null;
  name?: string | null;
  alt?: string;
  size?: keyof typeof sizeClasses;
  className?: string;
  imageClassName?: string;
};

export function BrandIcon({
  src,
  name,
  alt = "",
  size = "md",
  className,
  imageClassName,
}: BrandIconProps) {
  const initial = name?.trim().charAt(0).toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-black text-white",
        sizeClasses[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className={cn(
            "h-full w-full object-contain",
            imagePaddingClasses[size],
            imageClassName,
          )}
        />
      ) : initial ? (
        <span className="text-label font-semibold leading-none">{initial}</span>
      ) : null}
    </span>
  );
}
