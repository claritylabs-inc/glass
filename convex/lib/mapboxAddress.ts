const MAPBOX_FORWARD_GEOCODING_URL =
  "https://api.mapbox.com/search/geocode/v6/forward";

type MapboxContextItem = {
  name?: string;
  region_code?: string;
  country_code?: string;
  address_number?: string;
  street_name?: string;
};

type MapboxFeature = {
  geometry?: {
    coordinates?: unknown[];
  };
  properties?: {
    mapbox_id?: string;
    feature_type?: string;
    name?: string;
    name_preferred?: string;
    full_address?: string;
    coordinates?: {
      longitude?: number;
      latitude?: number;
      accuracy?: string;
    };
    match_code?: Record<string, unknown>;
    context?: Record<string, MapboxContextItem | undefined>;
  };
};

type MapboxGeocodingResponse = {
  features?: MapboxFeature[];
};

export type MapboxAddressCandidate = {
  mapboxFeatureId: string;
  formattedAddress: string;
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
  longitude?: number;
  latitude?: number;
  accuracy?: string;
  matchConfidence?: string;
  matchComponents: Record<string, string>;
  validation: "validated" | "plausible" | "ambiguous";
  validationReason: string;
};

export type MapboxAddressLookupResult = {
  status: "validated" | "candidates" | "not_found" | "unavailable";
  query: string;
  candidates: MapboxAddressCandidate[];
  message: string;
};

type LookupMapboxAddressOptions = {
  query: string;
  countryCode?: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function addressLineFromContext(
  context: Record<string, MapboxContextItem | undefined>,
) {
  const address = context.address;
  if (cleanText(address?.name)) return cleanText(address?.name);
  return [cleanText(address?.address_number), cleanText(address?.street_name)]
    .filter(Boolean)
    .join(" ") || undefined;
}

function matchComponentsFromProperties(
  properties: NonNullable<MapboxFeature["properties"]>,
) {
  const entries = Object.entries(properties.match_code ?? {}).filter(
    ([key, value]) => key !== "confidence" && typeof value === "string",
  );
  return Object.fromEntries(entries) as Record<string, string>;
}

function candidateValidation(
  featureType: string | undefined,
  accuracy: string | undefined,
  matchComponents: Record<string, string>,
) {
  const isAddress =
    featureType === "address" || featureType === "secondary_address";
  const addressNumberMatch = matchComponents.address_number;
  const streetMatch = matchComponents.street;
  const precisePoint = ["rooftop", "parcel", "point"].includes(accuracy ?? "");

  if (
    isAddress &&
    addressNumberMatch === "matched" &&
    streetMatch === "matched" &&
    precisePoint
  ) {
    return {
      validation: "validated" as const,
      validationReason:
        "Mapbox matched the address number and street to a known address point, rooftop, or parcel.",
    };
  }
  if (
    isAddress &&
    ["matched", "plausible"].includes(addressNumberMatch ?? "") &&
    streetMatch === "matched"
  ) {
    return {
      validation: "plausible" as const,
      validationReason:
        "Mapbox matched the street, but the address number is interpolated, extrapolated, or lacks precise point data.",
    };
  }
  return {
    validation: "ambiguous" as const,
    validationReason:
      "Mapbox did not match the address number and street precisely enough to validate this candidate.",
  };
}

function candidateFromFeature(
  feature: MapboxFeature,
): MapboxAddressCandidate | null {
  const properties = feature.properties;
  if (!properties) return null;

  const context = properties.context ?? {};
  const featureType = cleanText(properties.feature_type);
  const parentAddressLine = addressLineFromContext(context);
  const featureName =
    cleanText(properties.name_preferred) ?? cleanText(properties.name);
  const addressLine1 =
    featureType === "secondary_address"
      ? parentAddressLine ?? featureName
      : featureName ?? parentAddressLine;
  const mapboxFeatureId = cleanText(properties.mapbox_id);
  if (!mapboxFeatureId || !addressLine1) return null;

  const addressLine2 =
    featureType === "secondary_address"
      ? cleanText(context.secondary_address?.name)
      : undefined;
  const city =
    cleanText(context.place?.name) ??
    cleanText(context.locality?.name) ??
    cleanText(context.district?.name);
  const state =
    cleanText(context.region?.region_code) ?? cleanText(context.region?.name);
  const postalCode = cleanText(context.postcode?.name);
  const country = cleanText(context.country?.name);
  const countryCode = cleanText(context.country?.country_code)?.toUpperCase();
  const fallbackFormatted = [
    addressLine1,
    addressLine2,
    city,
    [state, postalCode].filter(Boolean).join(" "),
    country,
  ]
    .filter(Boolean)
    .join(", ");
  const matchComponents = matchComponentsFromProperties(properties);
  const accuracy = cleanText(properties.coordinates?.accuracy);
  const geometryCoordinates = feature.geometry?.coordinates ?? [];
  const longitude =
    finiteNumber(properties.coordinates?.longitude) ??
    finiteNumber(geometryCoordinates[0]);
  const latitude =
    finiteNumber(properties.coordinates?.latitude) ??
    finiteNumber(geometryCoordinates[1]);
  const validation = candidateValidation(featureType, accuracy, matchComponents);

  return {
    mapboxFeatureId,
    formattedAddress: cleanText(properties.full_address) ?? fallbackFormatted,
    addressLine1,
    ...(addressLine2 ? { addressLine2 } : {}),
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(country ? { country } : {}),
    ...(countryCode ? { countryCode } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(accuracy ? { accuracy } : {}),
    ...(cleanText(properties.match_code?.confidence)
      ? { matchConfidence: cleanText(properties.match_code?.confidence) }
      : {}),
    matchComponents,
    ...validation,
  };
}

export function mapboxAddressCandidates(response: MapboxGeocodingResponse) {
  return (response.features ?? [])
    .map(candidateFromFeature)
    .filter(
      (candidate): candidate is MapboxAddressCandidate => candidate !== null,
    );
}

export async function lookupMapboxAddress({
  query,
  countryCode,
  accessToken,
  fetchImpl = fetch,
  timeoutMs = 8_000,
}: LookupMapboxAddressOptions): Promise<MapboxAddressLookupResult> {
  const normalizedQuery = query.trim().replace(/\s+/g, " ").replace(/;/g, ",");
  if (!normalizedQuery) {
    return {
      status: "not_found",
      query: normalizedQuery,
      candidates: [],
      message: "No address was provided for validation.",
    };
  }

  const url = new URL(MAPBOX_FORWARD_GEOCODING_URL);
  url.searchParams.set("q", normalizedQuery.slice(0, 256));
  url.searchParams.set("types", "address");
  url.searchParams.set("autocomplete", "false");
  url.searchParams.set("limit", "3");
  url.searchParams.set("language", "en");
  // Certificate holder addresses are persisted, so this must use Mapbox's
  // permanent-geocoding contract rather than temporary search results.
  url.searchParams.set("permanent", "true");
  const normalizedCountryCode = countryCode?.trim().toLowerCase();
  if (normalizedCountryCode && /^[a-z]{2}$/.test(normalizedCountryCode)) {
    url.searchParams.set("country", normalizedCountryCode);
  }
  url.searchParams.set("access_token", accessToken);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        status: "unavailable",
        query: normalizedQuery,
        candidates: [],
        message: `Mapbox address lookup failed with HTTP ${response.status}.`,
      };
    }

    const candidates = mapboxAddressCandidates(
      (await response.json()) as MapboxGeocodingResponse,
    );
    if (candidates.length === 0) {
      return {
        status: "not_found",
        query: normalizedQuery,
        candidates: [],
        message:
          "Mapbox did not return an address match. Keep the user's original wording and ask for clarification before saving it.",
      };
    }

    const validated = candidates[0].validation === "validated";
    return {
      status: validated ? "validated" : "candidates",
      query: normalizedQuery,
      candidates,
      message: validated
        ? "Mapbox returned a validated address. Use the first candidate's structured fields."
        : "Mapbox returned address candidates but could not fully validate the first result. Ask the user to confirm the intended candidate before saving it.",
    };
  } catch (error) {
    return {
      status: "unavailable",
      query: normalizedQuery,
      candidates: [],
      message:
        error instanceof Error && error.name === "AbortError"
          ? "Mapbox address lookup timed out."
          : "Mapbox address lookup is temporarily unavailable.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
