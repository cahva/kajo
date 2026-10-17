import type { KajoSchema } from "../standard-schema.ts";

/** The lowercase HTTP method keys an OpenAPI path item can hold. */
export const OPENAPI_METHODS = [
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
] as const;

/** An uppercase HTTP method that an OpenAPI operation can be registered for. */
export type OpenApiMethod = Uppercase<(typeof OPENAPI_METHODS)[number]>;

/** The OpenAPI Info object describing an API. */
export interface OpenApiInfo {
  /** The API title. */
  readonly title: string;
  /** The version of the API document. */
  readonly version: string;
  /** Other Info object fields, kept as written. */
  readonly [key: string]: unknown;
}

/** An OpenAPI 3.1 document that Kajo can import or export. */
export interface OpenApiDocument {
  /** Metadata about the API. */
  readonly info?: OpenApiInfo;
  /** The OpenAPI specification version, such as `"3.1.0"`. */
  readonly openapi: string;
  /** Path items keyed by OpenAPI path template, such as `/pets/{petId}`. */
  readonly paths: Readonly<Record<string, OpenApiPathItem | OpenApiReference | undefined>>;
  /** Other top-level fields, such as `components` and `servers`. */
  readonly [key: string]: unknown;
}

/** The OpenAPI Path Item object: the operations available on one path. */
export interface OpenApiPathItem {
  /** The `DELETE` operation. */
  readonly delete?: OpenApiOperation;
  /** The `GET` operation. */
  readonly get?: OpenApiOperation;
  /** The `HEAD` operation. */
  readonly head?: OpenApiOperation;
  /** The `OPTIONS` operation. */
  readonly options?: OpenApiOperation;
  /** The `PATCH` operation. */
  readonly patch?: OpenApiOperation;
  /** The `POST` operation. */
  readonly post?: OpenApiOperation;
  /** The `PUT` operation. */
  readonly put?: OpenApiOperation;
  /** The `TRACE` operation. */
  readonly trace?: OpenApiOperation;
  /** Other Path Item fields, such as shared `parameters`. */
  readonly [key: string]: unknown;
}

/** The OpenAPI Operation object: one method on one path. */
export interface OpenApiOperation {
  /** A unique operation name. Kajo derives one from the method and path when omitted. */
  readonly operationId?: string;
  /** Path, query, header, and cookie parameters. */
  readonly parameters?: readonly (OpenApiParameter | OpenApiReference)[];
  /** The request body, or a Standard Schema for a JSON body on Kajo-defined routes. */
  readonly requestBody?: OpenApiRequestBody | OpenApiReference | KajoSchema;
  /** Responses keyed by status code or `default`. */
  readonly responses: Readonly<Record<string, OpenApiResponse | OpenApiReference | undefined>>;
  /** Other Operation fields, kept as written. */
  readonly [key: string]: unknown;
}

/** An OpenAPI operation attached to a route, with a required `operationId`. */
export interface OpenApiRouteContract extends OpenApiOperation {
  /** The operation name used in validation errors and exported documents. */
  readonly operationId: string;
}

/** The OpenAPI Response object. */
export interface OpenApiResponse {
  /** Response bodies keyed by media type. */
  readonly content?: Readonly<Record<string, OpenApiMediaType | undefined>>;
  /** A description of the response. */
  readonly description?: string;
  /** Other Response fields, such as `headers`. */
  readonly [key: string]: unknown;
}

/** The OpenAPI Parameter object. */
export interface OpenApiParameter {
  /** Whether array and object values are split into separate parameters. */
  readonly explode?: boolean;
  /** Where the parameter is read from. */
  readonly in: "cookie" | "header" | "path" | "query";
  /** The parameter name. */
  readonly name: string;
  /** Whether the request must include the parameter. Path parameters are always required. */
  readonly required?: boolean;
  /** The parameter's JSON Schema, or a Standard Schema on Kajo-defined routes. */
  readonly schema?: OpenApiSchema | OpenApiReference | KajoSchema | boolean;
  /** The serialization style, such as `form` or `deepObject`. */
  readonly style?: string;
  /** Other Parameter fields, kept as written. */
  readonly [key: string]: unknown;
}

/** The OpenAPI Request Body object. */
export interface OpenApiRequestBody {
  /** Accepted request bodies keyed by media type or media range. */
  readonly content: Readonly<Record<string, OpenApiMediaType | undefined>>;
  /** A description of the request body. */
  readonly description?: string;
  /** Whether the request must include a body. */
  readonly required?: boolean;
  /** Other Request Body fields, kept as written. */
  readonly [key: string]: unknown;
}

/** The OpenAPI Media Type object: a schema and examples for one content type. */
export interface OpenApiMediaType {
  /** A single example value. */
  readonly example?: unknown;
  /** Named examples. */
  readonly examples?: Readonly<Record<string, OpenApiExample | OpenApiReference | undefined>>;
  /** The body's JSON Schema, or a Standard Schema on Kajo-defined routes. */
  readonly schema?: OpenApiSchema | OpenApiReference | KajoSchema | boolean;
  /** Other Media Type fields, such as `encoding`. */
  readonly [key: string]: unknown;
}

/** The OpenAPI Example object. */
export interface OpenApiExample {
  /** The example value. */
  readonly value?: unknown;
  /** Other Example fields, such as `summary`. */
  readonly [key: string]: unknown;
}

/**
 * A JSON Schema 2020-12 object as used in OpenAPI 3.1. The listed keywords are
 * the ones Kajo reads when generating responses and decoding parameters.
 */
export interface OpenApiSchema {
  /** Subschemas the value must all match. */
  readonly allOf?: readonly (OpenApiSchema | OpenApiReference | boolean)[];
  /** Subschemas the value must match at least one of. */
  readonly anyOf?: readonly (OpenApiSchema | OpenApiReference | boolean)[];
  /** The only allowed value. */
  readonly const?: unknown;
  /** The default value. */
  readonly default?: unknown;
  /** The allowed values. */
  readonly enum?: readonly unknown[];
  /** A single example value, as allowed by OpenAPI. */
  readonly example?: unknown;
  /** Example values. */
  readonly examples?: readonly unknown[];
  /** An exclusive upper bound for numbers. */
  readonly exclusiveMaximum?: number;
  /** An exclusive lower bound for numbers. */
  readonly exclusiveMinimum?: number;
  /** A string format, such as `email` or `date-time`. */
  readonly format?: string;
  /** The schema for array items. */
  readonly items?: OpenApiSchema | OpenApiReference | boolean;
  /** The maximum array length. */
  readonly maxItems?: number;
  /** The maximum string length. */
  readonly maxLength?: number;
  /** An inclusive upper bound for numbers. */
  readonly maximum?: number;
  /** The minimum array length. */
  readonly minItems?: number;
  /** The minimum string length. */
  readonly minLength?: number;
  /** An inclusive lower bound for numbers. */
  readonly minimum?: number;
  /** A number the value must be a multiple of. */
  readonly multipleOf?: number;
  /** Subschemas the value must match exactly one of. */
  readonly oneOf?: readonly (OpenApiSchema | OpenApiReference | boolean)[];
  /** A regular expression strings must match. */
  readonly pattern?: string;
  /** Schemas for object properties. */
  readonly properties?: Readonly<
    Record<string, OpenApiSchema | OpenApiReference | boolean | undefined>
  >;
  /** Object properties that must be present. */
  readonly required?: readonly string[];
  /** The JSON type or types the value must have. */
  readonly type?: string | readonly string[];
  /** Whether array items must be unique. */
  readonly uniqueItems?: boolean;
  /** Other JSON Schema keywords, kept as written. */
  readonly [key: string]: unknown;
}

/** An OpenAPI Reference object pointing at another part of a document. */
export interface OpenApiReference {
  /** A JSON Pointer reference, such as `#/components/schemas/Pet`. */
  readonly $ref: string;
  /** Other Reference fields, such as `summary`. */
  readonly [key: string]: unknown;
}

/** An OpenAPI operation compiled into a Kajo route. */
export interface OpenApiRoute {
  /** The document the operation came from. */
  readonly document: OpenApiDocument;
  /** The HTTP method the route handles. */
  readonly method: OpenApiMethod;
  /** The path template as written in the document, such as `/pets/{petId}`. */
  readonly openApiPath: string;
  /** The operation definition. */
  readonly operation: OpenApiOperation;
  /** The operation name, from the document or derived from the method and path. */
  readonly operationId: string;
  /** The Kajo route path, such as `/pets/:petId`. */
  readonly path: string;
  /** The response generated from the operation's examples or schemas. */
  readonly response: Response;
  /** Whether the operation came from an imported document or a Kajo-defined route. */
  readonly source: "kajo" | "openapi";
}

/** Request values that passed a route's OpenAPI contract validation. */
export interface OpenApiValidatedRequest {
  /** The parsed and validated request body. */
  readonly body?: unknown;
  /** Validated parameter values, grouped by location and keyed by name. */
  readonly parameters: {
    readonly cookie: Readonly<Record<string, unknown>>;
    readonly header: Readonly<Record<string, unknown>>;
    readonly path: Readonly<Record<string, unknown>>;
    readonly query: Readonly<Record<string, unknown>>;
  };
}

/** One problem found while validating a request against its OpenAPI contract. */
export interface OpenApiValidationIssue {
  /** Where the invalid value was read from. */
  readonly location: OpenApiParameter["in"] | "body";
  /** A human-readable description of the problem. */
  readonly message: string;
  /** The parameter name, for parameter issues. */
  readonly name?: string;
  /** The path to the invalid value inside the parameter or body. */
  readonly path?: readonly (number | string)[];
}

/** The outcome of request validation: either issues or the validated values. */
export type OpenApiValidationResult =
  | { readonly issues: readonly OpenApiValidationIssue[] }
  | { readonly value: OpenApiValidatedRequest };

/** One problem reported by an {@link OpenApiSchemaValidator}. */
export interface OpenApiSchemaValidatorIssue {
  /** A human-readable description of the problem. */
  readonly message: string;
  /** The path to the invalid value. */
  readonly path?: readonly (number | string)[];
}

/** The outcome of a schema validation: either issues or the accepted value. */
export type OpenApiSchemaValidatorResult =
  | { readonly issues: readonly OpenApiSchemaValidatorIssue[] }
  | { readonly value: unknown };

/** Information about the value an {@link OpenApiSchemaValidator} is checking. */
export interface OpenApiSchemaValidatorContext {
  /** The imported document, for resolving local `$ref`s in the schema. */
  readonly document?: OpenApiDocument;
  /** Where the value was read from. */
  readonly location: OpenApiParameter["in"] | "body";
  /** The parameter name, for parameter values. */
  readonly name?: string;
  /** The operation being validated. */
  readonly operationId: string;
}

/**
 * Validates values against plain JSON Schemas from imported OpenAPI documents.
 * Pass one as the `openapiValidator` server option.
 */
export interface OpenApiSchemaValidator {
  /** Check a decoded parameter or parsed body against its schema. */
  validate(
    schema: OpenApiSchema | boolean,
    value: unknown,
    context: OpenApiSchemaValidatorContext,
  ): OpenApiSchemaValidatorResult | Promise<OpenApiSchemaValidatorResult>;
}
