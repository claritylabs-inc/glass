// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PhoneInput } from "@/components/ui/phone-input";

let mountedRoot: Root | null = null;

async function renderPhoneInput(initialValue = "+12025550102") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  let latestValue: string | undefined;

  function Harness() {
    const [value, setValue] = useState<string | undefined>(initialValue);

    return (
      <PhoneInput
        value={value}
        defaultCountry="US"
        onChange={(nextValue) => {
          latestValue = nextValue;
          setValue(nextValue);
        }}
      />
    );
  }

  await act(async () => root.render(<Harness />));

  return {
    container,
    get latestValue() {
      return latestValue;
    },
    async unmount() {
      await act(async () => root.unmount());
      if (mountedRoot === root) mountedRoot = null;
      container.remove();
    },
  };
}

async function openCountryMenu(container: HTMLElement) {
  const countrySelect = container.querySelector(
    '[data-slot="phone-country-select"]',
  );
  await act(async () => {
    countrySelect?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return countrySelect;
}

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = null;
  }
  document.body.replaceChildren();
});

describe("PhoneInput", () => {
  it("shows the calling code in the country control and national digits in the field", async () => {
    const harness = await renderPhoneInput();
    const input = harness.container.querySelector("input");
    const countrySelect = await openCountryMenu(harness.container);

    expect(input?.value).toBe("(202) 555-0102");
    expect(countrySelect?.textContent).toContain("+1");
    expect(countrySelect?.getAttribute("aria-label")).toContain("(+1)");

    const countryMenu = document.querySelector(
      '[data-slot="popover-content"]',
    );
    const optionPrefixes = countryMenu?.querySelectorAll(
      '[data-slot="phone-country-option-prefix"]',
    );
    expect(countryMenu?.textContent).toContain("United States");
    expect(optionPrefixes?.length).toBeGreaterThan(0);
    expect(optionPrefixes?.[0]?.className).toContain("ml-auto");
    expect(optionPrefixes?.[0]?.className).toContain("text-right");
    expect(optionPrefixes?.[0]?.className).toContain("w-14");

    await harness.unmount();
  });

  it("preserves national digits when the country changes", async () => {
    const harness = await renderPhoneInput("+1202");
    const input = harness.container.querySelector("input");
    await openCountryMenu(harness.container);
    const unitedKingdom = document.querySelector('[data-country="GB"]');

    expect(input?.value).toBe("(202)");
    await act(async () => {
      unitedKingdom?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(harness.latestValue).toBe("+44202");
    expect(input?.value).toContain("202");
    expect(input?.value).not.toContain("+44");
    expect(
      harness.container.querySelector(
        '[data-slot="phone-country-prefix"]',
      )?.textContent,
    ).toContain("+44");

    await harness.unmount();
  });

  it("accepts pasted international numbers as E.164 values", async () => {
    const harness = await renderPhoneInput();
    const input = harness.container.querySelector("input");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "+442079460018" },
    });

    await act(async () => {
      input?.dispatchEvent(paste);
    });

    expect(harness.latestValue).toBe("+442079460018");
    expect(input?.value).toBe("020 7946 0018");
    expect(
      harness.container.querySelector(
        '[data-slot="phone-country-prefix"]',
      )?.textContent,
    ).toContain("+44");

    await harness.unmount();
  });
});
