import { type } from "arktype";
import type { TaskBoardSchemas } from "./types.ts";

export const schemas = {
  task: type({
    status: '"backlog" | "in-progress" | "done"',
    title: "string > 0",
  }),
  user: type({
    name: "string > 0",
  }),
} satisfies TaskBoardSchemas;
