import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as z from "zod";
import { createServer, hasMany, model, type ModelAttributes } from "../src/index.ts";

describe("Standard JSON Schema models", () => {
  test("infers model attributes and retains a Zod schema", () => {
    const Task = z.object({
      completed: z.boolean().default(false),
      title: z.string(),
    });
    const definition = model(Task).extend({
      tags: hasMany("tag", { inverse: null }),
    });
    const server = createServer({
      intercept: false,
      models: {
        tag: model<{ name: string }>(),
        task: definition,
      },
    });
    const task = server.schema.tasks.create({
      completed: false,
      title: "Use Standard Schema",
    });

    expectTypeOf(task.title).toEqualTypeOf<string>();
    expectTypeOf<ModelAttributes<typeof definition>>().toEqualTypeOf<{
      completed: boolean;
      title: string;
    }>();
    expect(definition.schema).toBe(Task);
    expect(
      definition.schema["~standard"].jsonSchema.output({
        target: "draft-2020-12",
      }),
    ).toMatchObject({
      properties: {
        completed: { default: false, type: "boolean" },
        title: { type: "string" },
      },
      required: ["completed", "title"],
      type: "object",
    });
  });

  test("accepts Valibot through the same schema interface", () => {
    const Task = toStandardJsonSchema(
      v.object({
        completed: v.boolean(),
        title: v.string(),
      }),
    );
    const definition = model(Task);
    const server = createServer({
      intercept: false,
      models: { task: definition },
    });
    const task = server.schema.tasks.create({
      completed: true,
      title: "Bring your own validator",
    });

    expectTypeOf(task.completed).toEqualTypeOf<boolean>();
    expect(definition.schema["~standard"].vendor).toBe("valibot");
  });

  test("preserves type-only model definitions", () => {
    const definition = model<{ title: string }>();

    expectTypeOf<ModelAttributes<typeof definition>>().toEqualTypeOf<{ title: string }>();
    expect(definition.schema).toBeUndefined();
  });
});
