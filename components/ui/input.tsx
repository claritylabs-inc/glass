import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"
import { typeStyle } from "@/lib/typography";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        `h-9 w-full min-w-0 rounded-lg border border-input bg-popover px-3 py-1 transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-foreground placeholder:text-muted-foreground/40 focus-visible:border-border-focus focus-visible:ring-1 focus-visible:ring-input disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 ${typeStyle("control.input")}`,
        className
      )}
      {...props}
    />
  )
}

export { Input }
