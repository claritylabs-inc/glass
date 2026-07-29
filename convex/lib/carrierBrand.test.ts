import { describe, expect, it } from "vitest";
import {
  fallbackCarrierWebsiteIndex,
  normalizeCarrierBrandName,
} from "./carrierBrand";

describe("carrier brand identity", () => {
  it("normalizes legal carrier names for shared cache lookup", () => {
    expect(normalizeCarrierBrandName("Markel American Insurance Co.")).toBe(
      "markel american insurance co",
    );
  });

  it("falls back to the matching official domain when model selection fails", () => {
    const candidates = [
      {
        website: "https://www.dnb.com/",
        title: "Markel American Insurance Company profile",
      },
      {
        website: "https://www.markel.com/",
        title: "Specialty Insurance | Markel",
      },
      {
        website: "https://account.markelamerican.com/",
        title: "Log On",
      },
    ];

    expect(
      fallbackCarrierWebsiteIndex(
        "Markel American Insurance Company",
        candidates,
      ),
    ).toBe(1);
    expect(
      fallbackCarrierWebsiteIndex("HDI Global Specialty SE", [
        { website: "https://www.hdi.global/", title: "HDI Global" },
      ]),
    ).toBe(0);
  });

  it("does not accept a directory based on title text alone", () => {
    expect(
      fallbackCarrierWebsiteIndex("Markel American Insurance Company", [
        {
          website: "https://www.dnb.com/",
          title: "Markel American Insurance Company profile",
        },
      ]),
    ).toBe(-1);
  });

  it("does not conflate similarly named insurance businesses", () => {
    expect(
      fallbackCarrierWebsiteIndex("Northwoods Continental Insurance Company", [
        {
          website: "https://www.northwoodsins.com/",
          title: "Northwoods Insurance | Full-Service Insurance Brokerage",
        },
      ]),
    ).toBe(-1);
  });
});
