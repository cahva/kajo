import { type } from "arktype";
import type { TaskBoardSchemas } from "./types.ts";

const status = '"backlog" | "in-progress" | "done"';
const task = type({
  status,
  title: "string > 0",
});
const user = type({
  name: "string > 0",
});

export const schemas = {
  createTaskRequest: type({
    task: {
      assigneeId: "string > 0",
      status,
      title: "string > 0",
    },
  }),
  id: type("string > 0"),
  task,
  taskResponse: type({
    task: {
      assigneeId: "string",
      id: "string",
      status,
      title: "string",
    },
    users: type({
      id: "string",
      name: "string",
    }).array(),
  }),
  updateTaskRequest: type({
    task: { status },
  }),
  user,
} satisfies TaskBoardSchemas;
