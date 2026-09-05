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
const apiTask = v.object({
  assigneeId: v.string(),
  id: v.string(),
  status,
  title: v.string(),
});
const apiUser = v.object({
  id: v.string(),
  name: v.string(),
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
  summary: toStandardJsonSchema(
    v.object({
      done: v.pipe(v.number(), v.integer(), v.minValue(0)),
      open: v.pipe(v.number(), v.integer(), v.minValue(0)),
      total: v.pipe(v.number(), v.integer(), v.minValue(0)),
    }),
  ),
  task: toStandardJsonSchema(task),
  taskResponse: toStandardJsonSchema(
    v.object({
      task: apiTask,
      users: v.array(apiUser),
    }),
  ),
  tasksResponse: toStandardJsonSchema(
    v.object({
      tasks: v.array(apiTask),
      users: v.array(apiUser),
    }),
  ),
  updateTaskRequest: toStandardJsonSchema(
    v.object({
      task: v.object({ status }),
    }),
  ),
  user: toStandardJsonSchema(user),
} satisfies TaskBoardSchemas;
