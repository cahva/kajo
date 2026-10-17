import type { OpenApiDocument, OpenApiReference } from "./types.ts";

export class LocalReferenceResolver {
  constructor(readonly document: OpenApiDocument) {}

  resolve(value: object, location: string, seen = new Set<string>()): object {
    if ("$ref" in value && typeof value.$ref !== "string") {
      throw new TypeError(`OpenAPI $ref at ${location} must be a string.`);
    }

    if (!isReference(value)) {
      return value;
    }

    const reference = value.$ref;

    if (!reference.startsWith("#")) {
      throw new TypeError(`External OpenAPI $ref is not supported at ${location}: "${reference}".`);
    }

    if (seen.has(reference)) {
      throw new TypeError(`Circular OpenAPI $ref at ${location}: "${reference}".`);
    }

    seen.add(reference);
    const target = this.resolvePointer(reference, location);
    return this.resolve(target, location, seen);
  }

  private resolvePointer(reference: string, location: string): object {
    if (reference === "#") {
      return this.document;
    }

    if (!reference.startsWith("#/")) {
      throw new TypeError(`Invalid local OpenAPI $ref at ${location}: "${reference}".`);
    }

    let current: unknown = this.document;

    for (const encodedToken of reference.slice(2).split("/")) {
      const token = decodePointerToken(encodedToken, reference, location);

      if (
        typeof current !== "object" ||
        current === null ||
        !Object.prototype.hasOwnProperty.call(current, token)
      ) {
        throw new TypeError(`OpenAPI $ref at ${location} does not exist: "${reference}".`);
      }

      current = Reflect.get(current, token);
    }

    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      throw new TypeError(
        `OpenAPI $ref at ${location} does not point to an object: "${reference}".`,
      );
    }

    return current;
  }
}

export function isReference(value: object): value is OpenApiReference {
  return "$ref" in value && typeof value.$ref === "string";
}

function decodePointerToken(token: string, reference: string, location: string): string {
  try {
    const decoded = decodeURIComponent(token);

    if (/~(?:[^01]|$)/.test(decoded)) {
      throw new TypeError();
    }

    return decoded.replaceAll("~1", "/").replaceAll("~0", "~");
  } catch {
    throw new TypeError(`Invalid local OpenAPI $ref at ${location}: "${reference}".`);
  }
}
