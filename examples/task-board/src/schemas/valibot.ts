import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { TaskBoardSchemas } from "./types.ts";

export const schemas = {
  task: toStandardJsonSchema(
    v.object({
      status: v.picklist(["backlog", "in-progress", "done"]),
      title: v.pipe(v.string(), v.minLength(1)),
    }),
  ),
  user: toStandardJsonSchema(
    v.object({
      name: v.pipe(v.string(), v.minLength(1)),
    }),
  ),
} satisfies TaskBoardSchemas;
