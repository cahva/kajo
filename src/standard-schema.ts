import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";

/**
 * A schema that provides validation, inferred types, and JSON Schema conversion.
 *
 * Zod, ArkType, and converted Valibot schemas implement this interface without
 * an adapter owned by Kajo.
 */
export type KajoSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> &
  StandardJSONSchemaV1<Input, Output>;

/** The input type a {@link KajoSchema} accepts. */
export type InferSchemaInput<Schema extends KajoSchema> = StandardSchemaV1.InferInput<Schema>;

/** The output type a {@link KajoSchema} produces after validation and transforms. */
export type InferSchemaOutput<Schema extends KajoSchema> = StandardSchemaV1.InferOutput<Schema>;
