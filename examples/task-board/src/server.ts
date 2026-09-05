/// <reference types="vite/client" />

import {
  association,
  belongsTo,
  createServer,
  Factory,
  hasMany,
  model,
  Serializer,
  trait,
} from "../../../src/index.ts";
import type { SchemaName, Task, TaskBoardSchemas, User } from "./schemas/types.ts";

const schemaLoaders = {
  arktype: () => import("./schemas/arktype.ts"),
  valibot: () => import("./schemas/valibot.ts"),
  zod: () => import("./schemas/zod.ts"),
} satisfies Record<SchemaName, () => Promise<{ schemas: TaskBoardSchemas }>>;

export const schemaName = selectedSchema();
const { schemas } = await schemaLoaders[schemaName]();
const models = {
  task: model(schemas.task).extend({
    assignee: belongsTo("user"),
  }),
  user: model(schemas.user).extend({
    tasks: hasMany("task"),
  }),
};

export const server = createServer({
  factories: {
    task: Factory.extend<Task>({
      assignee: association(),
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

  logging: true,

  models,

  serializers: {
    task: Serializer.extend({
      include: ["assignee"],
    }),
  },

  seeds(server) {
    const [ada, linus] = server.createList("user", 2);

    server.create("task");
    server.create("task", "started", { assignee: linus });
    server.create("task", "completed", { assignee: ada });
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

function selectedSchema(): SchemaName {
  const selected = new URL(window.location.href).searchParams.get("schema");
  return selected === "arktype" || selected === "valibot" || selected === "zod" ? selected : "zod";
}
