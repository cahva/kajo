export function mediaTypePriority(mediaType: string): number {
  const normalized = normalizeMediaType(mediaType);

  if (normalized === "application/json") {
    return 0;
  }

  return normalized.endsWith("+json") ? 1 : 2;
}

export function isJsonMediaType(mediaType: string | undefined): boolean {
  if (!mediaType) {
    return false;
  }

  const normalized = normalizeMediaType(mediaType);
  return normalized === "application/json" || normalized.endsWith("+json");
}

export function normalizeMediaType(mediaType: string): string {
  return mediaType.split(";")[0]!.trim().toLowerCase();
}

export function mediaTypeMatches(range: string, mediaType: string): boolean {
  const normalizedRange = normalizeMediaType(range);

  if (normalizedRange === "*/*" || normalizedRange === mediaType) {
    return true;
  }

  const [rangeType, rangeSubtype] = normalizedRange.split("/");
  const [mediaTypeType] = mediaType.split("/");
  return rangeSubtype === "*" && rangeType === mediaTypeType;
}

export function mediaRangeSpecificity(range: string): number {
  const normalized = normalizeMediaType(range);
  return normalized === "*/*" ? 0 : normalized.endsWith("/*") ? 1 : 2;
}

export function serializeExampleBody(
  body: unknown,
  mediaType: string | undefined,
  operation: string,
): string {
  if (isJsonMediaType(mediaType)) {
    return JSON.stringify(body);
  }

  if (typeof body === "string") {
    return body;
  }

  if (typeof body === "boolean" || typeof body === "number" || typeof body === "bigint") {
    return `${body}`;
  }

  throw new TypeError(
    `OpenAPI example for "${operation}" must be scalar for media type "${mediaType}".`,
  );
}
