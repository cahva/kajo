const OPENAPI_METHODS = ["delete", "get", "head", "options", "patch", "post", "put"] as const;

export type OpenApiMethod = Uppercase<(typeof OPENAPI_METHODS)[number]>;

export interface OpenApiDocument {
  readonly openapi: string;
  readonly paths: Readonly<Record<string, OpenApiPathItem | OpenApiReference | undefined>>;
  readonly [key: string]: unknown;
}

export interface OpenApiPathItem {
  readonly delete?: OpenApiOperation;
  readonly get?: OpenApiOperation;
  readonly head?: OpenApiOperation;
  readonly options?: OpenApiOperation;
  readonly patch?: OpenApiOperation;
  readonly post?: OpenApiOperation;
  readonly put?: OpenApiOperation;
  readonly [key: string]: unknown;
}

export interface OpenApiOperation {
  readonly operationId?: string;
  readonly responses: Readonly<Record<string, OpenApiResponse | OpenApiReference | undefined>>;
  readonly [key: string]: unknown;
}

export interface OpenApiResponse {
  readonly content?: Readonly<Record<string, OpenApiMediaType | undefined>>;
  readonly description?: string;
  readonly [key: string]: unknown;
}

export interface OpenApiMediaType {
  readonly example?: unknown;
  readonly examples?: Readonly<Record<string, OpenApiExample | OpenApiReference | undefined>>;
  readonly schema?: OpenApiSchema | OpenApiReference;
  readonly [key: string]: unknown;
}

export interface OpenApiExample {
  readonly value?: unknown;
  readonly [key: string]: unknown;
}

export interface OpenApiSchema {
  readonly example?: unknown;
  readonly [key: string]: unknown;
}

export interface OpenApiReference {
  readonly $ref: string;
  readonly [key: string]: unknown;
}

export interface OpenApiRoute {
  readonly method: OpenApiMethod;
  readonly path: string;
  readonly response: Response;
}

/**
 * Compile example-backed operations from an OpenAPI 3.1 document into Kajo routes.
 */
export function compileOpenApiRoutes(document: OpenApiDocument): OpenApiRoute[] {
  if (!/^3\.1(?:\.|$)/.test(document.openapi)) {
    throw new TypeError(
      `Kajo supports OpenAPI 3.1 documents; received version "${document.openapi}".`,
    );
  }

  if (!document.paths || typeof document.paths !== "object") {
    throw new TypeError('An OpenAPI document must contain a "paths" object.');
  }

  const routes: OpenApiRoute[] = [];
  const registered = new Set<string>();
  const references = new LocalReferenceResolver(document);

  for (const [openApiPath, pathItemOrReference] of Object.entries(document.paths)) {
    if (!pathItemOrReference) {
      continue;
    }

    const path = toKajoPath(openApiPath);
    const pathItem = references.resolve(
      pathItemOrReference,
      `path item "${openApiPath}"`,
    ) as OpenApiPathItem;

    for (const method of OPENAPI_METHODS) {
      const operation = pathItem[method];

      if (!operation) {
        continue;
      }

      const routeMethod = method.toUpperCase() as OpenApiMethod;
      const identity = `${routeMethod} ${path}`;

      if (registered.has(identity)) {
        throw new TypeError(`OpenAPI defines duplicate Kajo route "${identity}".`);
      }

      registered.add(identity);
      routes.push({
        method: routeMethod,
        path,
        response: exampleResponse(operation, identity, references),
      });
    }
  }

  return routes;
}

function toKajoPath(path: string): string {
  if (!path.startsWith("/")) {
    throw new TypeError(`OpenAPI path "${path}" must start with "/".`);
  }

  const converted = path.replaceAll(/\{([^/{}]+)\}/g, ":$1");

  if (converted.includes("{") || converted.includes("}")) {
    throw new TypeError(`OpenAPI path "${path}" contains an invalid path template.`);
  }

  return converted;
}

function exampleResponse(
  operation: OpenApiOperation,
  identity: string,
  references: LocalReferenceResolver,
): Response {
  if (!operation.responses || typeof operation.responses !== "object") {
    throw new TypeError(
      `OpenAPI operation "${operation.operationId ?? identity}" has no responses.`,
    );
  }

  const selected = selectResponse(operation.responses);

  if (!selected) {
    throw new TypeError(
      `OpenAPI operation "${operation.operationId ?? identity}" has no successful response.`,
    );
  }

  const response = references.resolve(
    selected.response,
    `response for "${operation.operationId ?? identity}"`,
  ) as OpenApiResponse;
  const media = selectMediaType(response.content);
  const body = media
    ? selectExample(media.value, operation.operationId ?? identity, references)
    : undefined;

  if (selected.status === 204 || body === undefined) {
    return new Response(null, { status: selected.status });
  }

  return new Response(serializeExampleBody(body, media?.type, operation.operationId ?? identity), {
    headers: media ? { "content-type": media.type } : undefined,
    status: selected.status,
  });
}

function selectResponse(
  responses: OpenApiOperation["responses"],
): { readonly response: OpenApiResponse | OpenApiReference; readonly status: number } | undefined {
  const concrete = Object.entries(responses)
    .filter(
      (entry): entry is [string, OpenApiResponse | OpenApiReference] =>
        entry[1] !== undefined && /^2\d{2}$/.test(entry[0]),
    )
    .sort(([left], [right]) => Number(left) - Number(right))[0];

  if (concrete) {
    return { response: concrete[1], status: Number(concrete[0]) };
  }

  const wildcard = responses["2XX"];

  if (wildcard) {
    return { response: wildcard, status: 200 };
  }

  const fallback = responses.default;
  return fallback ? { response: fallback, status: 200 } : undefined;
}

function selectMediaType(
  content: OpenApiResponse["content"],
): { readonly type: string; readonly value: OpenApiMediaType } | undefined {
  const selected = Object.entries(content ?? {})
    .filter((entry): entry is [string, OpenApiMediaType] => entry[1] !== undefined)
    .sort(([left], [right]) => mediaTypePriority(left) - mediaTypePriority(right))[0];

  return selected ? { type: selected[0], value: selected[1] } : undefined;
}

function selectExample(
  mediaType: OpenApiMediaType,
  operation: string,
  references: LocalReferenceResolver,
): unknown {
  if (Object.prototype.hasOwnProperty.call(mediaType, "example")) {
    return mediaType.example;
  }

  for (const [name, candidate] of Object.entries(mediaType.examples ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!candidate) {
      continue;
    }

    const example = references.resolve(
      candidate,
      `example "${name}" for "${operation}"`,
    ) as OpenApiExample;

    if (Object.prototype.hasOwnProperty.call(example, "value")) {
      return example.value;
    }
  }

  return mediaType.schema
    ? (references.resolve(mediaType.schema, `schema for "${operation}"`) as OpenApiSchema).example
    : undefined;
}

class LocalReferenceResolver {
  constructor(private readonly document: OpenApiDocument) {}

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

function isReference(value: object): value is OpenApiReference {
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

function mediaTypePriority(mediaType: string): number {
  if (mediaType === "application/json") {
    return 0;
  }

  return mediaType.endsWith("+json") ? 1 : 2;
}

function isJsonMediaType(mediaType: string | undefined): boolean {
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

function serializeExampleBody(
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
