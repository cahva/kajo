import { z } from "zod";
import type { TaskBoardSchemas } from "./types.ts";

const status = z.enum(["backlog", "in-progress", "done"]);
const task = z.object({
  status,
  title: z.string().min(1),
});
const user = z.object({
  name: z.string().min(1),
});
const apiTask = task.extend({
  assigneeId: z.string(),
  id: z.string(),
});
const apiUser = user.extend({ id: z.string() });

export const schemas = {
  createTaskRequest: z.object({
    task: task.extend({
      assigneeId: z.string().min(1),
    }),
  }),
  id: z.string().min(1),
  summary: z.object({
    done: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  task,
  taskResponse: z.object({
    task: apiTask,
    users: z.array(apiUser),
  }),
  tasksResponse: z.object({
    tasks: z.array(apiTask),
    users: z.array(apiUser),
  }),
  updateTaskRequest: z.object({
    task: z.object({ status }),
  }),
  user,
} satisfies TaskBoardSchemas;
