import type { KajoSchema } from "../standard-schema.ts";
import { LocalReferenceResolver } from "./references.ts";
import { isKajoSchema, standardJsonSchema } from "./standard-schema.ts";
import type { OpenApiReference, OpenApiSchema } from "./types.ts";

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

export function generateSchemaValue(
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
