import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import type { TaskBoardSchemas } from "./types.ts";

const status = v.picklist(["backlog", "in-progress", "done"]);
const task = v.object({
  status,
  title: v.pipe(v.string(), v.minLength(1)),
});
const user = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
});

export const schemas = {
  createTaskRequest: toStandardJsonSchema(
    v.object({
      task: v.object({
        assigneeId: v.pipe(v.string(), v.minLength(1)),
        status,
        title: v.pipe(v.string(), v.minLength(1)),
      }),
    }),
  ),
  id: toStandardJsonSchema(v.pipe(v.string(), v.minLength(1))),
  task: toStandardJsonSchema(task),
  taskResponse: toStandardJsonSchema(
    v.object({
      task: v.object({
        assigneeId: v.string(),
        id: v.string(),
        status,
        title: v.string(),
      }),
      users: v.array(
        v.object({
          id: v.string(),
          name: v.string(),
        }),
      ),
    }),
  ),
  updateTaskRequest: toStandardJsonSchema(
    v.object({
      task: v.object({ status }),
    }),
  ),
  user: toStandardJsonSchema(user),
} satisfies TaskBoardSchemas;
