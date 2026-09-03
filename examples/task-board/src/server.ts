/// <reference types="vite/client" />

import {
  belongsTo,
  createServer,
  Factory,
  hasMany,
  model,
  type ModelFor,
  Serializer,
  type Server,
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

const models = {
  task: model<Task>().extend({
    assignee: belongsTo("user"),
  }),
  user: model<User>().extend({
    tasks: hasMany("task"),
  }),
};

type TaskBoardServer = Server<{}, typeof models>;
type TaskModel = ModelFor<typeof models, "task">;

export const server = createServer({
  factories: {
    task: Factory.extend<Task, TaskModel, TaskBoardServer>({
      afterCreate(task, server) {
        task.assignee ??= server.schema.users.first();
      },
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

  models,

  serializers: {
    task: Serializer.extend({
      include: ["assignee"],
    }),
  },

  seeds(server) {
    const [, linus, margaret] = server.createList("user", 3);

    server.create("task");
    server.create("task", "started", { assignee: linus });
    server.create("task", "completed", { assignee: margaret });
  },

  routes() {
    this.namespace = "/api";

    this.resource("tasks", {
      only: ["index", "create", "update", "delete"],
    });

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
