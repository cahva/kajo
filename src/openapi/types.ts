import type { KajoSchema } from "../standard-schema.ts";

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
  readonly trace?: OpenApiOperation;
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
  readonly exclusiveMaximum?: number;
  readonly exclusiveMinimum?: number;
  readonly format?: string;
  readonly items?: OpenApiSchema | OpenApiReference | boolean;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly multipleOf?: number;
  readonly oneOf?: readonly (OpenApiSchema | OpenApiReference | boolean)[];
  readonly pattern?: string;
  readonly properties?: Readonly<
    Record<string, OpenApiSchema | OpenApiReference | boolean | undefined>
  >;
  readonly required?: readonly string[];
  readonly type?: string | readonly string[];
  readonly uniqueItems?: boolean;
  readonly [key: string]: unknown;
}

export interface OpenApiReference {
  readonly $ref: string;
  readonly [key: string]: unknown;
}

export interface OpenApiRoute {
  readonly document: OpenApiDocument;
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

export interface OpenApiSchemaValidatorIssue {
  readonly message: string;
  readonly path?: readonly (number | string)[];
}

export type OpenApiSchemaValidatorResult =
  | { readonly issues: readonly OpenApiSchemaValidatorIssue[] }
  | { readonly value: unknown };

export interface OpenApiSchemaValidatorContext {
  readonly location: OpenApiParameter["in"] | "body";
  readonly name?: string;
  readonly operationId: string;
}

export interface OpenApiSchemaValidator {
  validate(
    schema: OpenApiSchema | boolean,
    value: unknown,
    context: OpenApiSchemaValidatorContext,
  ): OpenApiSchemaValidatorResult | Promise<OpenApiSchemaValidatorResult>;
}
