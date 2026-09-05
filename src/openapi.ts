import type { KajoSchema } from "./standard-schema.ts";
import { mediaTypePriority, serializeExampleBody } from "./openapi/media-types.ts";
import { isReference, LocalReferenceResolver } from "./openapi/references.ts";
export { OpenApiOperationRegistry } from "./openapi/registry.ts";
export { validateOpenApiRequest } from "./openapi/request-validation.ts";
import { isKajoSchema, standardJsonSchema } from "./openapi/standard-schema.ts";
import {
  OPENAPI_METHODS,
  type OpenApiDocument,
  type OpenApiExample,
  type OpenApiMediaType,
  type OpenApiMethod,
  type OpenApiOperation,
  type OpenApiPathItem,
  type OpenApiReference,
  type OpenApiRequestBody,
  type OpenApiResponse,
  type OpenApiRoute,
  type OpenApiRouteContract,
  type OpenApiSchema,
} from "./openapi/types.ts";

export type {
  OpenApiDocument,
  OpenApiExample,
  OpenApiInfo,
  OpenApiMediaType,
  OpenApiMethod,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiReference,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiRoute,
  OpenApiRouteContract,
  OpenApiSchema,
  OpenApiValidatedRequest,
  OpenApiValidationIssue,
  OpenApiValidationResult,
} from "./openapi/types.ts";

/**
 * Compile example-backed operations from an OpenAPI 3.1 document into Kajo routes.
 */
export function compileOpenApiRoutes(
  document: OpenApiDocument,
  options: { readonly generateResponses?: boolean } = {},
): OpenApiRoute[] {
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
        operation: normalizeOperation(operation, operationId),
        operationId,
        path,
        response:
          options.generateResponses === false
            ? new Response(null, { status: 204 })
            : exampleResponse(operation, identity, references, routeMethod),
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
  const completeContract = completePathParameters(contract, path);
  assertSupportedRequestContract(completeContract, path);
  const openApiPath = toOpenApiPath(path);
  const methodName = method.toLowerCase() as (typeof OPENAPI_METHODS)[number];
  const routes = compileOpenApiRoutes(
    {
      openapi: "3.1.0",
      paths: {
        [openApiPath]: {
          [methodName]: completeContract,
        },
      },
    },
    { generateResponses: false },
  );

  return { ...routes[0]!, source: "kajo" };
}

function completePathParameters(
  contract: OpenApiRouteContract,
  path: string,
): OpenApiRouteContract {
  const names = path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));
  const parameters = [...(contract.parameters ?? [])];

  for (const name of names) {
    const declared = parameters.find(
      (parameter) => !isReference(parameter) && parameter.in === "path" && parameter.name === name,
    );

    if (!declared) {
      parameters.push({
        in: "path",
        name,
        required: true,
        schema: { type: "string" },
      });
    }
  }

  return names.length > 0 || contract.parameters
    ? {
        ...contract,
        parameters,
      }
    : contract;
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

    if (
      parameter.in === "path" &&
      !path.split("/").some((segment) => segment === `:${parameter.name}`)
    ) {
      throw new TypeError(
        `OpenAPI route contract path parameter "${parameter.name}" does not exist in route "${path}".`,
      );
    }
  }
}

function normalizeOperation(operation: OpenApiOperation, operationId: string): OpenApiOperation {
  return {
    ...operation,
    parameters: operation.parameters?.map((parameter) =>
      isReference(parameter)
        ? parameter
        : {
            ...parameter,
            schema: normalizeSchema(
              parameter.schema,
              "input",
              `${operationId}:parameter:${parameter.in}:${parameter.name}`,
            ),
          },
    ),
    requestBody: normalizeRequestBody(operation.requestBody, operationId),
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
                            schema: normalizeSchema(
                              media.schema,
                              "output",
                              `${operationId}:response:${status}:${mediaType}`,
                            ),
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
  operationId: string,
): OpenApiRequestBody | OpenApiReference | undefined {
  if (!requestBody) {
    return undefined;
  }

  if (isKajoSchema(requestBody)) {
    return {
      content: {
        "application/json": {
          schema: normalizeSchema(requestBody, "input", `${operationId}:request:application/json`),
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
              schema: normalizeSchema(media.schema, "input", `${operationId}:request:${mediaType}`),
            }
          : media,
      ]),
    ),
  };
}

function normalizeSchema(
  schema: OpenApiMediaType["schema"],
  mode: "input" | "output",
  resourceName: string,
): OpenApiMediaType["schema"] {
  if (!isKajoSchema(schema)) {
    return schema;
  }

  const converted = standardJsonSchema(schema, mode);
  return hasRootReference(converted) && !("$id" in converted)
    ? {
        ...converted,
        $id: `urn:kajo:${encodeURIComponent(resourceName)}`,
      }
    : converted;
}

function hasRootReference(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return false;
  }

  seen.add(value);

  if ("$ref" in value && typeof value.$ref === "string" && value.$ref.startsWith("#")) {
    return true;
  }

  return Object.values(value).some((entry) => hasRootReference(entry, seen));
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
  method: OpenApiMethod,
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
  const body =
    method === "HEAD"
      ? undefined
      : media
        ? selectExample(media.value, operation.operationId ?? identity, references)
        : undefined;

  if (method === "HEAD") {
    return new Response(null, {
      headers: media ? { "content-type": media.type } : undefined,
      status: selected.status,
    });
  }

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
      return synthesizeString(schema, operation);
    }
    case "number": {
      return synthesizeNumber(schema, operation, false);
    }
    case "integer": {
      return synthesizeNumber(schema, operation, true);
    }
    case "boolean": {
      return true;
    }
    case "null": {
      return null;
    }
    case "array": {
      return synthesizeArray(schema, operation, references, active);
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

function synthesizeString(schema: OpenApiSchema, operation: string): string {
  if (typeof schema.pattern === "string") {
    throw new TypeError(
      `OpenAPI schema for "${operation}" uses "pattern" and requires an explicit example.`,
    );
  }

  const minimum = schema.minLength ?? 0;
  const maximum = schema.maxLength ?? Number.POSITIVE_INFINITY;

  if (
    minimum > maximum ||
    minimum < 0 ||
    !Number.isInteger(minimum) ||
    (Number.isFinite(maximum) && (maximum < 0 || !Number.isInteger(maximum)))
  ) {
    throw new TypeError(`OpenAPI schema for "${operation}" has incompatible string length limits.`);
  }

  let value =
    typeof schema.format === "string" ? (FORMAT_VALUES[schema.format] ?? "string") : "string";

  if (value.length < minimum) {
    if (schema.format) {
      throw new TypeError(
        `OpenAPI schema for "${operation}" has string constraints that require an explicit example.`,
      );
    }

    value = value.padEnd(minimum, "x");
  }

  if (value.length > maximum) {
    if (schema.format) {
      throw new TypeError(
        `OpenAPI schema for "${operation}" has string constraints that require an explicit example.`,
      );
    }

    value = value.slice(0, maximum);
  }

  return value;
}

function synthesizeNumber(schema: OpenApiSchema, operation: string, integer: boolean): number {
  const lower = schema.minimum ?? schema.exclusiveMinimum;
  const upper = schema.maximum ?? schema.exclusiveMaximum;
  const lowerExclusive = schema.minimum === undefined && schema.exclusiveMinimum !== undefined;
  const upperExclusive = schema.maximum === undefined && schema.exclusiveMaximum !== undefined;
  const multiple = schema.multipleOf;

  if (multiple !== undefined && (!Number.isFinite(multiple) || multiple <= 0)) {
    throw new TypeError(`OpenAPI schema for "${operation}" has an invalid "multipleOf".`);
  }

  let value = lower !== undefined ? lower : upper !== undefined && upper < 0 ? upper : 0;

  if (integer) {
    value = lower !== undefined ? Math.ceil(value) : Math.floor(value);

    if (lowerExclusive && value <= lower!) {
      value = Math.floor(lower!) + 1;
    }

    if (upperExclusive && value >= upper!) {
      value = Math.ceil(upper!) - 1;
    }
  } else {
    if (lowerExclusive && value <= lower!) {
      value =
        upper !== undefined
          ? lower! + (upper - lower!) / 2
          : lower! + Math.max(1, numericStep(lower!));
    }

    if (upperExclusive && value >= upper!) {
      value = upper! - Math.max(1, numericStep(upper!));
    }
  }

  if (multiple !== undefined) {
    value = alignMultiple(value, multiple, lower !== undefined);

    if (integer) {
      let attempts = 0;

      while (!Number.isInteger(value) && attempts < 10_000) {
        value += multiple;
        attempts += 1;
      }
    }
  }

  if (
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    (lower !== undefined && (lowerExclusive ? value <= lower : value < lower)) ||
    (upper !== undefined && (upperExclusive ? value >= upper : value > upper)) ||
    (multiple !== undefined && !isMultipleOf(value, multiple))
  ) {
    throw new TypeError(
      `OpenAPI schema for "${operation}" has numeric constraints that require an explicit example.`,
    );
  }

  return value;
}

function synthesizeArray(
  schema: OpenApiSchema,
  operation: string,
  references: LocalReferenceResolver,
  active: Set<object>,
): unknown[] {
  const minimum = schema.minItems ?? (schema.items === undefined || schema.maxItems === 0 ? 0 : 1);
  const maximum = schema.maxItems ?? Number.POSITIVE_INFINITY;

  if (
    minimum > maximum ||
    minimum < 0 ||
    !Number.isInteger(minimum) ||
    (Number.isFinite(maximum) && (maximum < 0 || !Number.isInteger(maximum)))
  ) {
    throw new TypeError(`OpenAPI schema for "${operation}" has incompatible array length limits.`);
  }

  if (schema.uniqueItems && minimum > 1) {
    throw new TypeError(
      `OpenAPI schema for "${operation}" uses "uniqueItems" and requires an explicit example.`,
    );
  }

  const item =
    schema.items === undefined
      ? null
      : generateSchemaValue(schema.items, operation, references, active);
  return Array.from({ length: minimum }, () => item);
}

function numericStep(value: number): number {
  return Math.max(Math.abs(value) * Number.EPSILON, Number.EPSILON);
}

function alignMultiple(value: number, multiple: number, roundUp: boolean): number {
  const ratio = value / multiple;
  return (roundUp ? Math.ceil(ratio) : Math.floor(ratio)) * multiple;
}

function isMultipleOf(value: number, multiple: number): boolean {
  const ratio = value / multiple;
  return Math.abs(ratio - Math.round(ratio)) < 1e-12;
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
