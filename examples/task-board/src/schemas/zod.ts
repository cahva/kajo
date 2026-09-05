import { z } from "zod";
import type { TaskBoardSchemas } from "./types.ts";

export const schemas = {
  task: z.object({
    status: z.enum(["backlog", "in-progress", "done"]),
    title: z.string().min(1),
  }),
  user: z.object({
    name: z.string().min(1),
  }),
} satisfies TaskBoardSchemas;
