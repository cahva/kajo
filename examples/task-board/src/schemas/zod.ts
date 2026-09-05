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

export const schemas = {
  createTaskRequest: z.object({
    task: task.extend({
      assigneeId: z.string().min(1),
    }),
  }),
  id: z.string().min(1),
  task,
  taskResponse: z.object({
    task: task.extend({
      assigneeId: z.string(),
      id: z.string(),
    }),
    users: z.array(user.extend({ id: z.string() })),
  }),
  updateTaskRequest: z.object({
    task: z.object({ status }),
  }),
  user,
} satisfies TaskBoardSchemas;
