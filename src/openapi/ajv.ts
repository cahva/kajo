import { Ajv2020, type ErrorObject, type Options, type ValidateFunction } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import type {
  OpenApiDocument,
  OpenApiSchema,
  OpenApiSchemaValidator,
  OpenApiSchemaValidatorContext,
  OpenApiSchemaValidatorResult,
} from "./types.ts";

export interface AjvOpenApiValidatorOptions {
  /** Additional Ajv options. Kajo always disables value coercion and mutation. */
  readonly ajv?: Options;
  /** Register ajv-formats. Defaults to true. */
  readonly formats?: boolean;
}

/**
 * Create an optional Ajv 2020-12 adapter for imported OpenAPI request schemas.
 */
export function createAjvOpenApiValidator(
  options: AjvOpenApiValidatorOptions = {},
): OpenApiSchemaValidator {
  const ajv = new Ajv2020({
    ...options.ajv,
    allErrors: true,
    coerceTypes: false,
    strict: options.ajv?.strict ?? false,
    useDefaults: false,
  });

  if (options.formats !== false) {
    formatsPlugin.default(ajv);
  }
  const documentValidators = new WeakMap<
    OpenApiDocument,
    WeakMap<OpenApiSchema, ValidateFunction>
  >();
  const standaloneValidators = new WeakMap<OpenApiSchema, ValidateFunction>();
  const booleanValidators = new Map<boolean, ValidateFunction>();

  return {
    validate(schema, value, context) {
      const validate = compiledValidator(
        ajv,
        schema,
        context,
        documentValidators,
        standaloneValidators,
        booleanValidators,
      );

      if (validate(value)) {
        return { value };
      }

      return {
        issues: (validate.errors ?? []).map(toValidationIssue),
      } satisfies OpenApiSchemaValidatorResult;
    },
  };
}

function compiledValidator(
  ajv: Ajv2020,
  schema: OpenApiSchema | boolean,
  context: OpenApiSchemaValidatorContext,
  documentValidators: WeakMap<OpenApiDocument, WeakMap<OpenApiSchema, ValidateFunction>>,
  standaloneValidators: WeakMap<OpenApiSchema, ValidateFunction>,
  booleanValidators: Map<boolean, ValidateFunction>,
): ValidateFunction {
  if (typeof schema === "boolean") {
    const cached = booleanValidators.get(schema);

    if (cached) {
      return cached;
    }

    const validate = ajv.compile(schema);
    booleanValidators.set(schema, validate);
    return validate;
  }

  const validators = context.document
    ? (documentValidators.get(context.document) ?? new WeakMap<OpenApiSchema, ValidateFunction>())
    : standaloneValidators;
  const cached = validators.get(schema);

  if (cached) {
    return cached;
  }

  const validate = ajv.compile(schemaForContext(schema, context));
  validators.set(schema, validate);

  if (context.document) {
    documentValidators.set(context.document, validators);
  }

  return validate;
}

function schemaForContext(
  schema: OpenApiSchema | boolean,
  context: OpenApiSchemaValidatorContext,
): object | boolean {
  if (typeof schema === "boolean" || !context.document) {
    return schema;
  }

  return {
    ...context.document,
    ...schema,
    $schema: "https://json-schema.org/draft/2020-12/schema",
  };
}

function toValidationIssue(error: ErrorObject): {
  readonly message: string;
  readonly path: readonly (number | string)[];
} {
  const path = error.instancePath.split("/").slice(1).map(decodePointerToken);

  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    path.push(error.params.missingProperty);
  }

  return {
    message: error.message ?? `Failed ${error.keyword} validation.`,
    path,
  };
}

function decodePointerToken(token: string): number | string {
  const decoded = token.replaceAll("~1", "/").replaceAll("~0", "~");
  return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
}
