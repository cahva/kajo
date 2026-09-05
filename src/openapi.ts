import type { KajoRequest } from "./http.ts";
import type { KajoSchema } from "./standard-schema.ts";

const OPENAPI_METHODS = ["delete", "get", "head", "options", "patch", "post", "put"] as const;
const STANDARD_JSON_SCHEMAS = {
  input: new WeakMap<KajoSchema, OpenApiSchema>(),
  output: new WeakMap<KajoSchema, OpenApiSchema>(),
};

export type OpenApiMethod = Uppercase<(typeof OPENAPI_METHODS)[number]>;

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly [key: string]: unknown;
}

export interface OpenApiDocument {
  readonly info?: OpenApiInfo;
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
  readonly parameters?: readonly (OpenApiParameter | OpenApiReference)[];
  readonly requestBody?: OpenApiRequestBody | OpenApiReference | KajoSchema;
  readonly responses: Readonly<Record<string, OpenApiResponse | OpenApiReference | undefined>>;
  readonly [key: string]: unknown;
}

export interface OpenApiRouteContract extends OpenApiOperation {
  readonly operationId: string;
}

export interface OpenApiResponse {
  readonly content?: Readonly<Record<string, OpenApiMediaType | undefined>>;
  readonly description?: string;
  readonly [key: string]: unknown;
}

export interface OpenApiParameter {
  readonly explode?: boolean;
  readonly in: "cookie" | "header" | "path" | "query";
  readonly name: string;
  readonly required?: boolean;
  readonly schema?: OpenApiSchema | OpenApiReference | KajoSchema | boolean;
  readonly style?: string;
  readonly [key: string]: unknown;
}

export interface OpenApiRequestBody {
  readonly content: Readonly<Record<string, OpenApiMediaType | undefined>>;
  readonly description?: string;
  readonly required?: boolean;
  readonly [key: string]: unknown;
}

export interface OpenApiMediaType {
  readonly example?: unknown;
  readonly examples?: Readonly<Record<string, OpenApiExample | OpenApiReference | undefined>>;
  readonly schema?: OpenApiSchema | OpenApiReference | KajoSchema | boolean;
  readonly [key: string]: unknown;
}

export interface OpenApiExample {
  readonly value?: unknown;
  readonly [key: string]: unknown;
}

export interface OpenApiSchema {
  readonly allOf?: readonly (OpenApiSchema | OpenApiReference | boolean)[];
  readonly anyOf?: readonly (OpenApiSchema | OpenApiReference | boolean)[];
  readonly const?: unknown;
  readonly default?: unknown;
  readonly enum?: readonly unknown[];
  readonly example?: unknown;
  readonly examples?: readonly unknown[];
  readonly exclusiveMinimum?: number;
  readonly format?: string;
  readonly items?: OpenApiSchema | OpenApiReference | boolean;
  readonly minimum?: number;
  readonly oneOf?: readonly (OpenApiSchema | OpenApiReference | boolean)[];
  readonly properties?: Readonly<
    Record<string, OpenApiSchema | OpenApiReference | boolean | undefined>
  >;
  readonly required?: readonly string[];
  readonly type?: string | readonly string[];
  readonly [key: string]: unknown;
}

export interface OpenApiReference {
  readonly $ref: string;
  readonly [key: string]: unknown;
}

export interface OpenApiRoute {
  readonly method: OpenApiMethod;
  readonly openApiPath: string;
  readonly operation: OpenApiOperation;
  readonly operationId: string;
  readonly path: string;
  readonly response: Response;
  readonly source: "kajo" | "openapi";
}

export interface OpenApiValidatedRequest {
  readonly body?: unknown;
  readonly parameters: {
    readonly cookie: Readonly<Record<string, unknown>>;
    readonly header: Readonly<Record<string, unknown>>;
    readonly path: Readonly<Record<string, unknown>>;
    readonly query: Readonly<Record<string, unknown>>;
  };
}

export interface OpenApiValidationIssue {
  readonly location: OpenApiParameter["in"] | "body";
  readonly message: string;
  readonly name?: string;
  readonly path?: readonly (number | string)[];
}

export type OpenApiValidationResult =
  | { readonly issues: readonly OpenApiValidationIssue[] }
  | { readonly value: OpenApiValidatedRequest };

export class OpenApiOperationRegistry {
  readonly #byIdentity = new Map<string, OpenApiRoute>();
  readonly #byOperationId = new Map<string, OpenApiRoute>();
  readonly #documents: OpenApiDocument[] = [];

  register(
    routes: readonly OpenApiRoute[],
    options: { readonly document?: OpenApiDocument; readonly replace?: boolean } = {},
  ): void {
    const identities = new Set<string>();
    const operationIds = new Set<string>();

    for (const route of routes) {
      const identity = `${route.method} ${route.path}`;
      const existingIdentity = this.#byIdentity.get(identity);
      const existingOperation = this.#byOperationId.get(route.operationId);

      if ((!options.replace && existingIdentity) || identities.has(identity)) {
        throw new TypeError(`OpenAPI operation "${identity}" is already registered.`);
      }

      if (
        (!options.replace && existingOperation) ||
        (existingOperation && existingOperation !== existingIdentity) ||
        operationIds.has(route.operationId)
      ) {
        throw new TypeError(`OpenAPI operationId "${route.operationId}" is already registered.`);
      }

      identities.add(identity);
      operationIds.add(route.operationId);
    }

    for (const route of routes) {
      const identity = `${route.method} ${route.path}`;
      const replaced = this.#byIdentity.get(identity);

      if (replaced) {
        this.#byOperationId.delete(replaced.operationId);
      }

      this.#byIdentity.set(identity, route);
      this.#byOperationId.set(route.operationId, route);
    }

    if (options.document) {
      this.#documents.push(options.document);
    }
  }

  document(info?: OpenApiInfo): OpenApiDocument {
    if (this.#documents.length > 1) {
      throw new TypeError("Cannot export more than one imported OpenAPI document yet.");
    }

    const imported = this.#documents[0];
    const documentInfo = info ?? imported?.info;

    if (!documentInfo) {
      throw new TypeError("OpenAPI export requires an info object with a title and version.");
    }

    const paths: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(imported?.paths ?? {}).flatMap(([path, pathItem]) =>
        pathItem ? [[path, isReference(pathItem) ? pathItem : { ...pathItem }]] : [],
      ),
    );

    for (const route of this.#byIdentity.values()) {
      if (route.source === "openapi") {
        continue;
      }

      const existing = paths[route.openApiPath];

      if (existing && isReference(existing)) {
        throw new TypeError(
          `Cannot replace operation in referenced OpenAPI path item "${route.openApiPath}".`,
        );
      }

      const pathItem = (paths[route.openApiPath] ??= {});
      pathItem[route.method.toLowerCase()] = route.operation;
    }

    return {
      ...imported,
      info: documentInfo,
      openapi: imported?.openapi ?? "3.1.0",
      paths: paths as OpenApiDocument["paths"],
    };
  }
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
      const operationId = operationIdFor(operation, method, openApiPath);

      if (registered.has(identity)) {
        throw new TypeError(`OpenAPI defines duplicate Kajo route "${identity}".`);
      }

      registered.add(identity);
      routes.push({
        method: routeMethod,
        openApiPath,
        operation: normalizeOperation(operation),
        operationId,
        path,
        response: exampleResponse(operation, identity, references),
        source: "openapi",
      });
    }
  }

  return routes;
}

export function compileOpenApiRouteContract(
  method: OpenApiMethod,
  path: string,
  contract: OpenApiRouteContract,
): OpenApiRoute {
  assertSupportedRequestContract(contract, path);
  const openApiPath = toOpenApiPath(path);
  const methodName = method.toLowerCase() as (typeof OPENAPI_METHODS)[number];
  const routes = compileOpenApiRoutes({
    openapi: "3.1.0",
    paths: {
      [openApiPath]: {
        [methodName]: contract,
      },
    },
  });

  return { ...routes[0]!, source: "kajo" };
}

function assertSupportedRequestContract(contract: OpenApiRouteContract, path: string): void {
  if (contract.requestBody && isReference(contract.requestBody)) {
    throw new TypeError(`OpenAPI route contract "${path}" cannot use a requestBody $ref yet.`);
  }

  for (const parameter of contract.parameters ?? []) {
    if (isReference(parameter)) {
      throw new TypeError(`OpenAPI route contract "${path}" cannot use parameter $ref values yet.`);
    }

    const supportedStyle =
      parameter.in === "query" || parameter.in === "cookie" ? "form" : "simple";

    if (parameter.style && parameter.style !== supportedStyle) {
      throw new TypeError(
        `OpenAPI route contract parameter "${parameter.name}" uses unsupported ${parameter.in} style "${parameter.style}".`,
      );
    }

    if (parameter.in === "path" && parameter.required !== true) {
      throw new TypeError(
        `OpenAPI route contract path parameter "${parameter.name}" must be required.`,
      );
    }
  }
}

function normalizeOperation(operation: OpenApiOperation): OpenApiOperation {
  return {
    ...operation,
    parameters: operation.parameters?.map((parameter) =>
      isReference(parameter)
        ? parameter
        : {
            ...parameter,
            schema: normalizeSchema(parameter.schema, "input"),
          },
    ),
    requestBody: normalizeRequestBody(operation.requestBody),
    responses: Object.fromEntries(
      Object.entries(operation.responses).map(([status, response]) => [
        status,
        response && !isReference(response)
          ? {
              ...response,
              content: response.content
                ? Object.fromEntries(
                    Object.entries(response.content).map(([mediaType, media]) => [
                      mediaType,
                      media
                        ? {
                            ...media,
                            schema: normalizeSchema(media.schema, "output"),
                          }
                        : media,
                    ]),
                  )
                : undefined,
            }
          : response,
      ]),
    ),
  };
}

function normalizeRequestBody(
  requestBody: OpenApiOperation["requestBody"],
): OpenApiRequestBody | OpenApiReference | undefined {
  if (!requestBody) {
    return undefined;
  }

  if (isKajoSchema(requestBody)) {
    return {
      content: {
        "application/json": {
          schema: normalizeSchema(requestBody, "input"),
        },
      },
      required: true,
    };
  }

  if (isReference(requestBody)) {
    return requestBody;
  }

  return {
    ...requestBody,
    content: Object.fromEntries(
      Object.entries(requestBody.content).map(([mediaType, media]) => [
        mediaType,
        media
          ? {
              ...media,
              schema: normalizeSchema(media.schema, "input"),
            }
          : media,
      ]),
    ),
  };
}

function normalizeSchema(
  schema: OpenApiMediaType["schema"],
  mode: "input" | "output",
): OpenApiMediaType["schema"] {
  return isKajoSchema(schema) ? standardJsonSchema(schema, mode) : schema;
}

export async function validateOpenApiRequest(
  contract: OpenApiRouteContract,
  request: KajoRequest,
): Promise<OpenApiValidationResult> {
  const issues: OpenApiValidationIssue[] = [];
  const parameters: Record<OpenApiParameter["in"], Record<string, unknown>> = {
    cookie: {},
    header: {},
    path: {},
    query: {},
  };

  for (const parameter of contract.parameters ?? []) {
    if (isReference(parameter)) {
      continue;
    }

    const value = parameterValue(parameter, request);

    if (value === undefined) {
      if (parameter.required) {
        issues.push({
          location: parameter.in,
          message: `Required ${parameter.in} parameter "${parameter.name}" is missing.`,
          name: parameter.name,
        });
      }

      continue;
    }

    if (isKajoSchema(parameter.schema)) {
      const validation = await validateStandardSchema(parameter.schema, value);

      if (validation.issues) {
        issues.push(
          ...validation.issues.map((issue) => ({
            location: parameter.in,
            message: issue.message,
            name: parameter.name,
            path: standardIssuePath(issue.path),
          })),
        );
        continue;
      }

      parameters[parameter.in][parameter.name] = validation.value;
    } else {
      parameters[parameter.in][parameter.name] = value;
    }
  }

  const body = await validateRequestBody(contract.requestBody, request, issues);

  return issues.length > 0
    ? { issues }
    : {
        value: {
          body,
          parameters,
        },
      };
}

async function validateRequestBody(
  requestBody: OpenApiOperation["requestBody"],
  request: KajoRequest,
  issues: OpenApiValidationIssue[],
): Promise<unknown> {
  if (!requestBody || isReference(requestBody)) {
    return undefined;
  }

  let directSchema: KajoSchema | undefined;
  let definition: OpenApiRequestBody | undefined;

  if (isKajoSchema(requestBody)) {
    directSchema = requestBody;
  } else {
    definition = requestBody;
  }

  const required = directSchema !== undefined || definition?.required === true;

  if (!request.requestBody) {
    if (required) {
      issues.push({
        location: "body",
        message: "Required request body is missing.",
      });
    }

    return undefined;
  }

  const contentType = request.original.headers.get("content-type")?.split(";")[0]?.trim();
  const media = definition ? selectRequestMediaType(definition, contentType) : undefined;

  if (directSchema && contentType && !isJsonMediaType(contentType)) {
    issues.push({
      location: "body",
      message: `Content type "${contentType}" is not declared by this operation.`,
    });
    return undefined;
  }

  if (definition && !media) {
    issues.push({
      location: "body",
      message: `Content type "${contentType ?? "(missing)"}" is not declared by this operation.`,
    });
    return undefined;
  }

  const mediaType = directSchema ? "application/json" : media?.type;
  const schema = directSchema ?? media?.value.schema;
  let value: unknown = request.requestBody;

  if (isJsonMediaType(mediaType)) {
    try {
      value = JSON.parse(request.requestBody);
    } catch {
      issues.push({
        location: "body",
        message: "Request body is not valid JSON.",
      });
      return undefined;
    }
  }

  if (!isKajoSchema(schema)) {
    return value;
  }

  const validation = await validateStandardSchema(schema, value);

  if (validation.issues) {
    issues.push(
      ...validation.issues.map((issue) => ({
        location: "body" as const,
        message: issue.message,
        path: standardIssuePath(issue.path),
      })),
    );
    return undefined;
  }

  return validation.value;
}

function selectRequestMediaType(
  requestBody: OpenApiRequestBody,
  contentType: string | undefined,
): { readonly type: string; readonly value: OpenApiMediaType } | undefined {
  if (contentType && requestBody.content[contentType]) {
    return { type: contentType, value: requestBody.content[contentType] };
  }

  if (!contentType) {
    return selectMediaType(requestBody.content);
  }

  return undefined;
}

function parameterValue(parameter: OpenApiParameter, request: KajoRequest): unknown {
  const url = new URL(request.url);
  let values: string[];

  switch (parameter.in) {
    case "path": {
      const value = request.params[parameter.name];
      values = value === undefined ? [] : [value];
      break;
    }
    case "query": {
      values = url.searchParams.getAll(parameter.name);
      break;
    }
    case "header": {
      const value = request.original.headers.get(parameter.name);
      values = value === null ? [] : [value];
      break;
    }
    case "cookie": {
      const value = requestCookie(request.original.headers.get("cookie"), parameter.name);
      values = value === undefined ? [] : [value];
      break;
    }
  }

  if (values.length === 0) {
    return undefined;
  }

  if (!isArraySchema(parameter.schema)) {
    return values.at(-1);
  }

  const explode = parameter.explode ?? (parameter.in === "query" || parameter.in === "cookie");
  return explode ? values : values.flatMap((value) => value.split(","));
}

function isArraySchema(schema: OpenApiParameter["schema"]): boolean {
  if (!isKajoSchema(schema)) {
    return (
      typeof schema === "object" &&
      schema !== null &&
      !isReference(schema) &&
      (schema.type === "array" || (Array.isArray(schema.type) && schema.type.includes("array")))
    );
  }

  const jsonSchema = standardJsonSchema(schema, "input");
  const type = Reflect.get(jsonSchema, "type");
  return type === "array" || (Array.isArray(type) && type.includes("array"));
}

function requestCookie(header: string | null, name: string): string | undefined {
  for (const cookie of header?.split(";") ?? []) {
    const separator = cookie.indexOf("=");

    if (separator !== -1 && cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim();
    }
  }

  return undefined;
}

async function validateStandardSchema(schema: KajoSchema, value: unknown) {
  return schema["~standard"].validate(value);
}

function standardIssuePath(
  path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined,
): readonly (number | string)[] | undefined {
  return path?.map((segment) => {
    const key =
      typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment;
    return typeof key === "symbol" ? (key.description ?? key.toString()) : key;
  });
}

function operationIdFor(
  operation: OpenApiOperation,
  method: (typeof OPENAPI_METHODS)[number],
  path: string,
): string {
  if (operation.operationId !== undefined) {
    if (!operation.operationId.trim()) {
      throw new TypeError(
        `OpenAPI operation "${method.toUpperCase()} ${path}" has an empty operationId.`,
      );
    }

    return operation.operationId;
  }

  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll(/[{}]/g, ""))
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`);

  return `${method}${segments.join("")}`;
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

function toOpenApiPath(path: string): string {
  if (path.includes("*")) {
    throw new TypeError(`OpenAPI route contract "${path}" cannot contain a wildcard.`);
  }

  return path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? `{${segment.slice(1)}}` : segment))
    .join("/");
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

  if (fallback) {
    return { response: fallback, status: 200 };
  }

  const documented = Object.entries(responses)
    .filter(
      (entry): entry is [string, OpenApiResponse | OpenApiReference] =>
        entry[1] !== undefined && /^[1-5]\d{2}$/.test(entry[0]),
    )
    .sort(([left], [right]) => Number(left) - Number(right))[0];

  return documented ? { response: documented[1], status: Number(documented[0]) } : undefined;
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

  if (mediaType.schema === undefined) {
    return undefined;
  }

  return generateSchemaValue(mediaType.schema, operation, references, new Set());
}

const FORMAT_VALUES: Readonly<Record<string, string>> = {
  date: "2024-01-01",
  "date-time": "2024-01-01T00:00:00Z",
  duration: "P1D",
  email: "user@example.com",
  hostname: "example.com",
  "idn-email": "user@example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  time: "00:00:00Z",
  uri: "https://example.com/",
  "uri-reference": "https://example.com/",
  uuid: "00000000-0000-0000-0000-000000000000",
};

function generateSchemaValue(
  schema: OpenApiSchema | OpenApiReference | KajoSchema | boolean,
  operation: string,
  references: LocalReferenceResolver,
  active: Set<object>,
): unknown {
  if (schema === true) {
    return {};
  }

  if (schema === false) {
    throw new TypeError(`OpenAPI schema for "${operation}" is "false" and permits no values.`);
  }

  const resolved = isKajoSchema(schema)
    ? standardJsonSchema(schema, "output")
    : (references.resolve(schema, `schema for "${operation}"`) as OpenApiSchema);

  if (active.has(resolved)) {
    throw new TypeError(
      `Recursive OpenAPI schema for "${operation}" requires an explicit example.`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(resolved, "example")) {
    return resolved.example;
  }

  if (Array.isArray(resolved.examples) && resolved.examples.length > 0) {
    return resolved.examples[0];
  }

  if (Object.prototype.hasOwnProperty.call(resolved, "const")) {
    return resolved.const;
  }

  if (Object.prototype.hasOwnProperty.call(resolved, "default")) {
    return resolved.default;
  }

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }

  active.add(resolved);

  try {
    return synthesizeSchemaValue(resolved, operation, references, active);
  } finally {
    active.delete(resolved);
  }
}

function synthesizeSchemaValue(
  schema: OpenApiSchema,
  operation: string,
  references: LocalReferenceResolver,
  active: Set<object>,
): unknown {
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return mergeAllOf(schema.allOf, operation, references, active);
  }

  for (const branches of [schema.oneOf, schema.anyOf]) {
    if (Array.isArray(branches) && branches.length > 0) {
      return generateSchemaValue(branches[0], operation, references, active);
    }
  }

  const type = firstNonNullType(schema.type);

  switch (type) {
    case undefined: {
      return Array.isArray(schema.type) ? null : {};
    }
    case "string": {
      return typeof schema.format === "string"
        ? (FORMAT_VALUES[schema.format] ?? "string")
        : "string";
    }
    case "integer":
    case "number": {
      if (typeof schema.minimum === "number") {
        return schema.minimum;
      }

      return typeof schema.exclusiveMinimum === "number" ? schema.exclusiveMinimum + 1 : 0;
    }
    case "boolean": {
      return true;
    }
    case "null": {
      return null;
    }
    case "array": {
      return schema.items === undefined
        ? []
        : [generateSchemaValue(schema.items, operation, references, active)];
    }
    case "object": {
      const value: Record<string, unknown> = {};

      for (const [name, property] of Object.entries(schema.properties ?? {}).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        if (property !== undefined) {
          value[name] = generateSchemaValue(property, operation, references, active);
        }
      }

      return value;
    }
    default: {
      throw new TypeError(`OpenAPI schema for "${operation}" has unsupported type "${type}".`);
    }
  }
}

function mergeAllOf(
  branches: readonly (OpenApiSchema | OpenApiReference | boolean)[],
  operation: string,
  references: LocalReferenceResolver,
  active: Set<object>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const branch of branches) {
    const value = generateSchemaValue(branch, operation, references, active);

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError(
        `OpenAPI schema for "${operation}" has an "allOf" that does not produce an object.`,
      );
    }

    Object.assign(merged, value);
  }

  return merged;
}

function firstNonNullType(type: OpenApiSchema["type"]): string | undefined {
  if (typeof type === "string") {
    return type;
  }

  if (!Array.isArray(type)) {
    return undefined;
  }

  return type.find((entry): entry is string => typeof entry === "string" && entry !== "null");
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

function isKajoSchema(value: unknown): value is KajoSchema {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }

  const standard = Reflect.get(value, "~standard");
  return (
    typeof standard === "object" &&
    standard !== null &&
    typeof Reflect.get(standard, "validate") === "function" &&
    typeof Reflect.get(Reflect.get(standard, "jsonSchema") ?? {}, "output") === "function"
  );
}

function standardJsonSchema(schema: KajoSchema, mode: "input" | "output"): OpenApiSchema {
  const cached = STANDARD_JSON_SCHEMAS[mode].get(schema);

  if (cached) {
    return cached;
  }

  const converted = schema["~standard"].jsonSchema[mode]({
    target: "draft-2020-12",
  }) as OpenApiSchema;
  STANDARD_JSON_SCHEMAS[mode].set(schema, converted);
  return converted;
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
