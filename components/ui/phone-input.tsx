"use client"

import * as React from "react"
import PhoneNumberInput, {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumber,
  type Country,
} from "react-phone-number-input/input"
import flags from "react-phone-number-input/flags"
import countryLabels from "react-phone-number-input/locale/en"
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
import { typeStyle } from "@/lib/typography";

export type PhoneInputValue = string | undefined

interface PhoneInputProps
  extends Omit<
    React.ComponentProps<typeof PhoneNumberInput>,
    "country" | "international" | "onChange" | "value"
  > {
  value?: PhoneInputValue
  onChange?: (value: PhoneInputValue) => void
  defaultCountry?: Country
  countries?: Country[]
}

type CountryOption = {
  value: Country
  label: string
}

type CountrySelectProps = {
  value: Country
  options: CountryOption[]
  onChange: (country: Country) => void
  disabled?: boolean
  readOnly?: boolean
}

const ALL_COUNTRIES = getCountries()

function phoneNumber(value?: string) {
  if (!value) return undefined
  try {
    return parsePhoneNumber(value)
  } catch {
    return undefined
  }
}

function countryForValue(
  value: string | undefined,
  countries: Country[],
  fallback?: Country,
) {
  const parsed = phoneNumber(value)
  if (parsed?.country && countries.includes(parsed.country)) {
    return parsed.country
  }
  if (parsed?.countryCallingCode) {
    if (
      fallback &&
      getCountryCallingCode(fallback) === parsed.countryCallingCode
    ) {
      return fallback
    }
    return countries.find(
      (country) =>
        getCountryCallingCode(country) === parsed.countryCallingCode,
    )
  }
  return undefined
}

function valueUsesCountry(value: string | undefined, country: Country) {
  return value?.startsWith(`+${getCountryCallingCode(country)}`) ?? false
}

function nationalDigits(value: string | undefined, country: Country) {
  if (!value) return ""
  const callingCode = getCountryCallingCode(country)
  const parsed = phoneNumber(value)
  if (parsed?.countryCallingCode === callingCode) {
    return parsed.nationalNumber
  }
  const digits = value.replace(/\D/g, "")
  return digits.startsWith(callingCode)
    ? digits.slice(callingCode.length)
    : digits
}

function CountryFlag({ country, label }: { country: Country; label: string }) {
  const Flag = flags[country]
  if (!Flag) return null
  return (
    <span className="w-5 shrink-0 overflow-hidden [&>svg]:block [&>svg]:h-auto [&>svg]:w-full">
      <Flag title={label} />
    </span>
  )
}

function CountrySelect({
  value,
  options,
  onChange,
  disabled,
  readOnly,
}: CountrySelectProps) {
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)
  const isDisabled = disabled || readOnly
  const callingCode = getCountryCallingCode(value)

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
            data-slot="phone-country-select"
            className={`inline-flex h-full shrink-0 items-center gap-2 rounded-l-lg rounded-r-none border-r border-input px-3 text-foreground transition-colors hover:bg-foreground/5 disabled:pointer-events-none disabled:opacity-50 ${typeStyle("control.button")}`}
            disabled={isDisabled}
            aria-label={`Country: ${selected?.label ?? value} (+${callingCode})`}
          >
            <CountryFlag country={value} label={selected?.label ?? value} />
            <span
              data-slot="phone-country-prefix"
              className={`min-w-8 text-right text-muted-foreground ${typeStyle("data.numeric")}`}
            >
              +{callingCode}
            </span>
          </button>
        )}
      />

      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput ref={inputRef} placeholder="Search country or code" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const country = option.value
                const optionCallingCode = getCountryCallingCode(country)

                return (
                  <CommandItem
                    key={country}
                    data-country={country}
                    data-current={country === value}
                    className="data-[current=true]:bg-foreground/[0.035] [&>svg:last-child]:hidden"
                    value={`${option.label} +${optionCallingCode} ${country}`}
                    onSelect={() => {
                      onChange(country)
                      setOpen(false)
                    }}
                  >
                    <CountryFlag country={country} label={option.label} />
                    <span className="truncate">{option.label}</span>
                    <span
                      data-slot="phone-country-option-prefix"
                      className={`ml-auto w-14 text-right text-muted-foreground ${typeStyle("data.numeric")}`}
                    >
                      +{optionCallingCode}
                    </span>
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
        `h-full w-full min-w-0 bg-transparent px-3 placeholder:text-muted-foreground/40 outline-none ${typeStyle("control.input")}`,
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
  onPaste,
  placeholder = "Enter phone number",
  value,
  defaultCountry = "US",
  countries,
  disabled,
  readOnly,
  ...props
}: PhoneInputProps) {
  const availableCountries = React.useMemo(
    () => (countries?.length ? countries : ALL_COUNTRIES),
    [countries]
  )
  const fallbackCountry = availableCountries.includes(defaultCountry)
    ? defaultCountry
    : availableCountries[0] ?? "US"
  const [selectedCountry, setSelectedCountry] = React.useState<Country>(
    () =>
      countryForValue(value, availableCountries, fallbackCountry) ??
      fallbackCountry
  )
  const valueCountry = valueUsesCountry(value, selectedCountry)
    ? selectedCountry
    : countryForValue(value, availableCountries, fallbackCountry)
  const resolvedCountry = valueCountry ?? selectedCountry
  const options = React.useMemo(
    () =>
      availableCountries
        .map((country) => ({
          value: country,
          label: countryLabels[country],
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [availableCountries]
  )

  function changeCountry(nextCountry: Country) {
    const digits = nationalDigits(value, resolvedCountry)
    setSelectedCountry(nextCountry)
    onChange?.(
      digits ? `+${getCountryCallingCode(nextCountry)}${digits}` : undefined
    )
  }

  function pasteInternationalNumber(event: React.ClipboardEvent<HTMLInputElement>) {
    onPaste?.(event)
    if (event.defaultPrevented) return
    const pasted = event.clipboardData.getData("text").trim()
    if (!pasted.startsWith("+")) return
    const parsed = phoneNumber(pasted)
    const nextCountry = countryForValue(
      pasted,
      availableCountries,
      selectedCountry
    )
    if (!parsed?.number || !nextCountry) return
    event.preventDefault()
    setSelectedCountry(nextCountry)
    onChange?.(parsed.number)
  }

  return (
    <div
      className={cn(
        "PhoneInput flex h-9 items-center rounded-lg border border-input bg-popover transition-colors focus-within:border-border-focus focus-within:ring-1 focus-within:ring-input",
        className
      )}
    >
      <CountrySelect
        value={resolvedCountry}
        options={options}
        onChange={changeCountry}
        disabled={disabled}
        readOnly={readOnly}
      />
      <PhoneNumberInput
        {...props}
        value={value}
        onChange={(nextValue) => onChange?.(nextValue)}
        onPaste={pasteInternationalNumber}
        country={resolvedCountry}
        international={false}
        inputComponent={PhoneInputField}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
      />
    </div>
  )
}
