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
const apiTask = type({
  assigneeId: "string",
  id: "string",
  status,
  title: "string",
});
const apiUser = type({
  id: "string",
  name: "string",
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
  summary: type({
    done: "number.integer >= 0",
    open: "number.integer >= 0",
    total: "number.integer >= 0",
  }),
  task,
  taskResponse: type({
    task: apiTask,
    users: apiUser.array(),
  }),
  tasksResponse: type({
    tasks: apiTask.array(),
    users: apiUser.array(),
  }),
  updateTaskRequest: type({
    task: { status },
  }),
  user,
} satisfies TaskBoardSchemas;
