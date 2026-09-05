import type { KajoRequest } from "../http.ts";
import type { KajoSchema } from "../standard-schema.ts";
import {
  isJsonMediaType,
  mediaRangeSpecificity,
  mediaTypeMatches,
  mediaTypePriority,
  normalizeMediaType,
} from "./media-types.ts";
import { isReference, LocalReferenceResolver } from "./references.ts";
import { isKajoSchema, standardJsonSchema } from "./standard-schema.ts";
import type {
  OpenApiMediaType,
  OpenApiDocument,
  OpenApiParameter,
  OpenApiRequestBody,
  OpenApiRouteContract,
  OpenApiSchema,
  OpenApiSchemaValidator,
  OpenApiSchemaValidatorContext,
  OpenApiSchemaValidatorResult,
  OpenApiValidationIssue,
  OpenApiValidationResult,
} from "./types.ts";

export async function validateOpenApiRequest(
  contract: OpenApiRouteContract,
  request: KajoRequest,
  options: {
    readonly document?: OpenApiDocument;
    readonly validator?: OpenApiSchemaValidator;
  } = {},
): Promise<OpenApiValidationResult> {
  const issues: OpenApiValidationIssue[] = [];
  const parameters: Record<OpenApiParameter["in"], Record<string, unknown>> = {
    cookie: {},
    header: {},
    path: {},
    query: {},
  };
  const references = options.document ? new LocalReferenceResolver(options.document) : undefined;

  for (const parameterOrReference of contract.parameters ?? []) {
    const parameter = resolveObject<OpenApiParameter>(
      parameterOrReference,
      references,
      `parameter for "${contract.operationId}"`,
    );

    const schema = resolveSchema(
      parameter.schema,
      references,
      `parameter "${parameter.name}" for "${contract.operationId}"`,
    );
    const value = parameterValue(parameter, request, schema);

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
      continue;
    }

    const validation = await validatePlainSchema(schema, value, options.validator, {
      location: parameter.in,
      name: parameter.name,
      operationId: contract.operationId,
    });

    if (validation && "issues" in validation) {
      issues.push(
        ...validation.issues.map((issue) => ({
          location: parameter.in,
          message: issue.message,
          name: parameter.name,
          path: issue.path,
        })),
      );
      continue;
    }

    parameters[parameter.in][parameter.name] =
      validation && "value" in validation ? validation.value : value;
  }

  const body = await validateRequestBody(contract, request, issues, references, options.validator);

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
  operation: OpenApiRouteContract,
  request: KajoRequest,
  issues: OpenApiValidationIssue[],
  references: LocalReferenceResolver | undefined,
  validator: OpenApiSchemaValidator | undefined,
): Promise<unknown> {
  if (!operation.requestBody) {
    return undefined;
  }
  const requestBody = resolveObject<OpenApiRequestBody | KajoSchema>(
    operation.requestBody,
    references,
    `request body for "${operation.operationId}"`,
  );

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

  const validation = isKajoSchema(schema)
    ? await validateStandardSchema(schema, value)
    : await validatePlainSchema(
        resolveSchema(schema, references, `request body for "${operation.operationId}"`),
        value,
        validator,
        { location: "body", operationId: operation.operationId },
      );

  if (validation && "issues" in validation) {
    issues.push(
      ...validation.issues.map((issue) => ({
        location: "body" as const,
        message: issue.message,
        path: standardIssuePath(issue.path),
      })),
    );
    return undefined;
  }

  return validation && "value" in validation ? validation.value : value;
}

function selectRequestMediaType(
  requestBody: OpenApiRequestBody,
  contentType: string | undefined,
): { readonly type: string; readonly value: OpenApiMediaType } | undefined {
  if (!contentType) {
    return selectMediaType(requestBody.content);
  }

  const actual = normalizeMediaType(contentType);
  const selected = Object.entries(requestBody.content)
    .filter(
      (entry): entry is [string, OpenApiMediaType] =>
        entry[1] !== undefined && mediaTypeMatches(entry[0], actual),
    )
    .sort(([left], [right]) => mediaRangeSpecificity(right) - mediaRangeSpecificity(left))[0];

  return selected ? { type: actual, value: selected[1] } : undefined;
}

function selectMediaType(
  content: OpenApiRequestBody["content"],
): { readonly type: string; readonly value: OpenApiMediaType } | undefined {
  const selected = Object.entries(content)
    .filter((entry): entry is [string, OpenApiMediaType] => entry[1] !== undefined)
    .sort(([left], [right]) => mediaTypePriority(left) - mediaTypePriority(right))[0];

  return selected ? { type: selected[0], value: selected[1] } : undefined;
}

function parameterValue(
  parameter: OpenApiParameter,
  request: KajoRequest,
  resolvedSchema?: OpenApiSchema | boolean,
): unknown {
  const url = new URL(request.url);
  const schema = parameterJsonSchema(parameter.schema, resolvedSchema);

  if (schema && schemaHasType(schema, "object")) {
    return objectParameterValue(parameter, request, url, schema);
  }

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

  if (!schema || !schemaHasType(schema, "array")) {
    return decodePrimitive(values.at(-1), schema);
  }

  const explode = parameter.explode ?? (parameter.in === "query" || parameter.in === "cookie");
  const items = explode ? values : values.flatMap((value) => value.split(","));
  const itemSchema = parameterJsonSchema(schema.items);
  return items.map((value) => decodePrimitive(value, itemSchema));
}

function objectParameterValue(
  parameter: OpenApiParameter,
  request: KajoRequest,
  url: URL,
  schema: OpenApiSchema,
): Record<string, unknown> | undefined {
  const explode = parameter.explode ?? (parameter.in === "query" || parameter.in === "cookie");

  if (explode && (parameter.in === "query" || parameter.in === "cookie")) {
    const object: Record<string, unknown> = {};

    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      const values =
        parameter.in === "query"
          ? url.searchParams.getAll(name)
          : [requestCookie(request.original.headers.get("cookie"), name)].filter(
              (value): value is string => value !== undefined,
            );

      if (values.length > 0) {
        const propertySchema = parameterJsonSchema(property);
        object[name] =
          propertySchema && schemaHasType(propertySchema, "array")
            ? values.map((value) =>
                decodePrimitive(value, parameterJsonSchema(propertySchema.items)),
              )
            : decodePrimitive(values.at(-1), propertySchema);
      }
    }

    return Object.keys(object).length > 0 ? object : undefined;
  }

  const serialized =
    parameter.in === "query"
      ? url.searchParams.get(parameter.name)
      : parameter.in === "header"
        ? request.original.headers.get(parameter.name)
        : parameter.in === "cookie"
          ? requestCookie(request.original.headers.get("cookie"), parameter.name)
          : request.params[parameter.name];

  if (serialized === null || serialized === undefined) {
    return undefined;
  }

  const parts = serialized.split(",");
  const entries = explode
    ? parts.flatMap((part) => {
        const separator = part.indexOf("=");
        return separator === -1 ? [] : [[part.slice(0, separator), part.slice(separator + 1)]];
      })
    : Array.from({ length: Math.floor(parts.length / 2) }, (_, index) => [
        parts[index * 2]!,
        parts[index * 2 + 1]!,
      ]);

  return entries.length > 0
    ? Object.fromEntries(
        entries.map(([name, value]) => [
          name,
          decodePrimitive(value, parameterJsonSchema(schema.properties?.[name])),
        ]),
      )
    : undefined;
}

function decodePrimitive(value: string | undefined, schema: OpenApiSchema | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (schemaHasType(schema, "integer") || schemaHasType(schema, "number")) {
    const number = Number(value);
    return Number.isNaN(number) ? value : number;
  }

  if (schemaHasType(schema, "boolean")) {
    return value === "true" ? true : value === "false" ? false : value;
  }

  return value;
}

function parameterJsonSchema(
  schema: OpenApiParameter["schema"] | undefined,
  resolved?: OpenApiSchema | boolean,
): OpenApiSchema | undefined {
  if (isKajoSchema(schema)) {
    return standardJsonSchema(schema, "input");
  }

  const candidate = resolved ?? schema;
  return typeof candidate === "object" && candidate !== null && !isReference(candidate)
    ? candidate
    : undefined;
}

function schemaHasType(schema: OpenApiSchema | undefined, expected: string): boolean {
  return (
    schema?.type === expected || (Array.isArray(schema?.type) && schema.type.includes(expected))
  );
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

function resolveObject<Value extends object>(
  value: Value | import("./types.ts").OpenApiReference,
  references: LocalReferenceResolver | undefined,
  location: string,
): Value {
  return isReference(value) && references
    ? (references.resolve(value, location) as Value)
    : (value as Value);
}

function resolveSchema(
  schema: OpenApiParameter["schema"] | undefined,
  references: LocalReferenceResolver | undefined,
  location: string,
): OpenApiSchema | boolean | undefined {
  if (
    schema === undefined ||
    typeof schema === "boolean" ||
    isKajoSchema(schema) ||
    !isReference(schema)
  ) {
    return isKajoSchema(schema) ? standardJsonSchema(schema, "input") : schema;
  }

  return references ? (references.resolve(schema, location) as OpenApiSchema) : undefined;
}

async function validatePlainSchema(
  schema: OpenApiSchema | boolean | undefined,
  value: unknown,
  validator: OpenApiSchemaValidator | undefined,
  context: OpenApiSchemaValidatorContext,
): Promise<OpenApiSchemaValidatorResult | undefined> {
  return schema !== undefined && validator ? validator.validate(schema, value, context) : undefined;
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
