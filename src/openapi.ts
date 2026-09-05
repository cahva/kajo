import { mediaTypePriority, serializeExampleBody } from "./openapi/media-types.ts";
import { isReference, LocalReferenceResolver } from "./openapi/references.ts";
export { OpenApiOperationRegistry } from "./openapi/registry.ts";
export { validateOpenApiRequest } from "./openapi/request-validation.ts";
import { generateSchemaValue } from "./openapi/schema-generation.ts";
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
