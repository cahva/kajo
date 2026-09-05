import type { KajoSchema } from "../standard-schema.ts";
import type { OpenApiSchema } from "./types.ts";

const JSON_SCHEMAS = {
  input: new WeakMap<KajoSchema, OpenApiSchema>(),
  output: new WeakMap<KajoSchema, OpenApiSchema>(),
};

export function isKajoSchema(value: unknown): value is KajoSchema {
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

export function standardJsonSchema(schema: KajoSchema, mode: "input" | "output"): OpenApiSchema {
  const cached = JSON_SCHEMAS[mode].get(schema);

  if (cached) {
    return cached;
  }

  const converted = schema["~standard"].jsonSchema[mode]({
    target: "draft-2020-12",
  }) as OpenApiSchema;
  JSON_SCHEMAS[mode].set(schema, converted);
  return converted;
}
