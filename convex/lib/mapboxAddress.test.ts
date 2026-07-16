import { describe, expect, test } from "vitest";

import { lookupMapboxAddress, mapboxAddressCandidates } from "./mapboxAddress";

const ottawaResponse = {
  features: [
    {
      geometry: { coordinates: [-75.719, 45.408] },
      properties: {
        mapbox_id: "mapbox-address-ottawa",
        feature_type: "address",
        name: "7 Bayview Station Road",
        full_address:
          "7 Bayview Station Road, Ottawa, Ontario K1Y 2C5, Canada",
        coordinates: {
          longitude: -75.719,
          latitude: 45.408,
          accuracy: "point",
        },
        match_code: {
          address_number: "matched",
          street: "matched",
          postcode: "unmatched",
          place: "matched",
          region: "unmatched",
          country: "matched",
          confidence: "low",
        },
        context: {
          address: {
            name: "7 Bayview Station Road",
            address_number: "7",
            street_name: "Bayview Station Road",
          },
          postcode: { name: "K1Y 2C5" },
          place: { name: "Ottawa" },
          region: { name: "Ontario", region_code: "ON" },
          country: { name: "Canada", country_code: "CA" },
        },
      },
    },
  ],
};

describe("Mapbox address lookup", () => {
  test("normalizes a precise international address into COI fields", () => {
    expect(mapboxAddressCandidates(ottawaResponse)).toEqual([
      expect.objectContaining({
        mapboxFeatureId: "mapbox-address-ottawa",
        formattedAddress:
          "7 Bayview Station Road, Ottawa, Ontario K1Y 2C5, Canada",
        addressLine1: "7 Bayview Station Road",
        city: "Ottawa",
        state: "ON",
        postalCode: "K1Y 2C5",
        country: "Canada",
        countryCode: "CA",
        accuracy: "point",
        matchConfidence: "low",
        validation: "validated",
        validationReason:
          "Mapbox matched the address number and street to a known address point, rooftop, or parcel.",
      }),
    ]);
  });

  test("uses non-autocomplete permanent geocoding for persistable results", async () => {
    let requestedUrl: URL | undefined;
    const fetchImpl: typeof fetch = async (input) => {
      requestedUrl = new URL(String(input));
      return new Response(JSON.stringify(ottawaResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await lookupMapboxAddress({
      query: "7 Bayview Station Rd in Ottawa Canada",
      countryCode: "CA",
      accessToken: "mapbox-test-token",
      fetchImpl,
    });

    expect(result.status).toBe("validated");
    expect(result.candidates[0]).toMatchObject({
      addressLine1: "7 Bayview Station Road",
      city: "Ottawa",
      state: "ON",
      postalCode: "K1Y 2C5",
      country: "Canada",
    });
    expect(requestedUrl?.pathname).toBe("/search/geocode/v6/forward");
    expect(requestedUrl?.searchParams.get("autocomplete")).toBe("false");
    expect(requestedUrl?.searchParams.get("permanent")).toBe("true");
    expect(requestedUrl?.searchParams.get("types")).toBe("address");
    expect(requestedUrl?.searchParams.get("country")).toBe("ca");
  });

  test("does not present interpolated address numbers as validated", () => {
    const candidates = mapboxAddressCandidates({
      features: [
        {
          ...ottawaResponse.features[0],
          properties: {
            ...ottawaResponse.features[0].properties,
            coordinates: { accuracy: "interpolated" },
            match_code: {
              address_number: "plausible",
              street: "matched",
              confidence: "low",
            },
          },
        },
      ],
    });

    expect(candidates[0].validation).toBe("plausible");
  });

  test("returns a safe unavailable result when Mapbox rejects the request", async () => {
    const result = await lookupMapboxAddress({
      query: "7 Bayview Station Rd, Ottawa, Canada",
      accessToken: "mapbox-test-token",
      fetchImpl: async () => new Response("Unauthorized", { status: 401 }),
    });

    expect(result).toEqual({
      status: "unavailable",
      query: "7 Bayview Station Rd, Ottawa, Canada",
      candidates: [],
      message: "Mapbox address lookup failed with HTTP 401.",
    });
    expect(JSON.stringify(result)).not.toContain("mapbox-test-token");
  });
});
