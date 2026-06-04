"use client"

import * as React from "react"
import PhoneInputOriginal, {
  getCountryCallingCode,
  type Country,
} from "react-phone-number-input"
import flags from "react-phone-number-input/flags"
import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

export type PhoneInputValue = string | undefined

interface PhoneInputProps
  extends Omit<React.ComponentProps<typeof PhoneInputOriginal>, "onChange"> {
  onChange?: (value: PhoneInputValue) => void
}

type CountryOption = {
  value?: Country
  label: string
  divider?: boolean
}

type CountrySelectProps = {
  value?: Country
  options?: CountryOption[]
  onChange: (country?: Country) => void
  disabled?: boolean
  readOnly?: boolean
  iconComponent: React.ComponentType<{
    country?: Country
    label: string
  }>
}

function CountrySelect({
  value,
  options = [],
  onChange,
  disabled,
  readOnly,
  iconComponent: Icon,
}: CountrySelectProps) {
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)
  const isDisabled = disabled || readOnly
  const countries = options.filter((option) => option.value && !option.divider)

  React.useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(id)
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            className="inline-flex h-full shrink-0 items-center gap-2 rounded-md px-2 text-base text-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-50"
            disabled={isDisabled}
            aria-label="Select country"
          >
            <Icon country={value} label={selected?.label ?? "Select country"} />
            <span className="text-muted-foreground">+{value ? getCountryCallingCode(value) : ""}</span>
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </button>
        )}
      />

      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput ref={inputRef} placeholder="Search country or code" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {countries.map((option) => {
                const country = option.value as Country
                const isSelected = country === value

                return (
                  <CommandItem
                    key={country}
                    value={`${option.label} +${getCountryCallingCode(country)} ${country}`}
                    onSelect={() => {
                      onChange(country)
                      setOpen(false)
                    }}
                  >
                    <Icon country={country} label={option.label} />
                    <span className="truncate">{option.label}</span>
                    <span className="ml-auto text-label text-muted-foreground">+{getCountryCallingCode(country)}</span>
                    {isSelected ? <CheckIcon className="text-foreground" /> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

const PhoneInputField = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "h-full w-full bg-transparent px-3 text-base placeholder:text-muted-foreground/40 outline-none",
        className
      )}
      {...props}
    />
  )
})
PhoneInputField.displayName = "PhoneInputField"

export function PhoneInput({
  className,
  onChange,
  placeholder = "Enter phone number",
  ...props
}: PhoneInputProps) {
  return (
    <PhoneInputOriginal
      countrySelectComponent={CountrySelect}
      flags={flags}
      inputComponent={PhoneInputField}
      className={cn(
        "PhoneInput flex h-10 items-center rounded-lg border border-foreground/8 bg-popover px-2 transition-colors focus-within:border-foreground/20 focus-within:ring-1 focus-within:ring-foreground/8 [&_.PhoneInputCountry]:h-full [&_.PhoneInputCountry]:shrink-0 [&_.PhoneInputCountry]:pr-2 [&_.PhoneInputCountry]:border-r [&_.PhoneInputCountry]:border-foreground/8 [&_.PhoneInputInput]:min-w-0",
        className
      )}
      onChange={(value) => onChange?.(value)}
      placeholder={placeholder}
      {...props}
    />
  )
}
