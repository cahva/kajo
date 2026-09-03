const OPENAPI_METHODS = ["delete", "get", "head", "options", "patch", "post", "put"] as const;

export type OpenApiMethod = Uppercase<(typeof OPENAPI_METHODS)[number]>;

export interface OpenApiDocument {
  readonly openapi: string;
  readonly paths: Readonly<Record<string, OpenApiPathItem | undefined>>;
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
  readonly schema?: {
    readonly example?: unknown;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface OpenApiExample {
  readonly value?: unknown;
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

  for (const [openApiPath, pathItem] of Object.entries(document.paths)) {
    if (!pathItem) {
      continue;
    }

    const path = toKajoPath(openApiPath);

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
        response: exampleResponse(operation, identity),
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

function exampleResponse(operation: OpenApiOperation, identity: string): Response {
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

  const response = dereference(
    selected.response,
    `response for "${operation.operationId ?? identity}"`,
  );
  const media = selectMediaType(response.content);
  const body = media ? selectExample(media.value, operation.operationId ?? identity) : undefined;

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

function selectExample(mediaType: OpenApiMediaType, operation: string): unknown {
  if (Object.prototype.hasOwnProperty.call(mediaType, "example")) {
    return mediaType.example;
  }

  for (const [name, candidate] of Object.entries(mediaType.examples ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!candidate) {
      continue;
    }

    const example = dereference(candidate, `example "${name}" for "${operation}"`);

    if (Object.prototype.hasOwnProperty.call(example, "value")) {
      return example.value;
    }
  }

  return mediaType.schema?.example;
}

function dereference<Value extends object>(
  value: Value | OpenApiReference,
  location: string,
): Value {
  if ("$ref" in value) {
    throw new TypeError(`OpenAPI $ref is not supported yet at ${location}: "${value.$ref}".`);
  }

  return value;
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
