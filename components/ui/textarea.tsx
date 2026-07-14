import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-fixed min-h-16 w-full rounded-lg border border-foreground/8 bg-popover px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground/40 focus-visible:border-foreground/20 focus-visible:ring-1 focus-visible:ring-foreground/8 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
