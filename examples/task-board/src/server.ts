/// <reference types="vite/client" />

import {
  belongsTo,
  createServer,
  Factory,
  hasMany,
  model,
  Serializer,
  trait,
} from "../../../src/index.ts";

export type TaskStatus = "backlog" | "in-progress" | "done";

interface Task {
  status: TaskStatus;
  title: string;
}

interface User {
  name: string;
}

export const server = createServer({
  factories: {
    task: Factory.extend<Task>({
      status: "backlog",
      title(sequence) {
        return ["Design empty states", "Model task relationships", "Wire up request interception"][
          sequence % 3
        ]!;
      },
      completed: trait<Task>({
        status: "done",
      }),
      started: trait<Task>({
        status: "in-progress",
      }),
    }),
    user: Factory.extend<User>({
      name(sequence) {
        return ["Ada", "Linus", "Margaret"][sequence % 3]!;
      },
    }),
  },

  models: {
    task: model<Task>().extend({
      assignee: belongsTo("user"),
    }),
    user: model<User>().extend({
      tasks: hasMany("task"),
    }),
  },

  serializers: {
    task: Serializer.extend({
      include: ["assignee"],
    }),
  },

  seeds(server) {
    const [ada, linus, margaret] = server.createList("user", 3);

    server.create("task", { assignee: margaret });
    server.create("task", "started", { assignee: ada });
    server.create("task", "completed", { assignee: linus });
  },

  routes() {
    this.namespace = "/api";

    this.get("/tasks");
    this.post("/tasks");
    this.patch("/tasks/:id");
    this.del("/tasks/:id");

    this.get("/summary", (schema) => {
      const tasks = schema.tasks.all().models;

      return {
        done: tasks.filter((task) => task.status === "done").length,
        open: tasks.filter((task) => task.status !== "done").length,
        total: tasks.length,
      };
    });
  },
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => server.shutdown());
}
