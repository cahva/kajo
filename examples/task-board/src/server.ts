/// <reference types="vite/client" />

import {
  association,
  belongsTo,
  createServer,
  Factory,
  hasMany,
  HttpError,
  model,
  Serializer,
  trait,
} from "../../../src/index.ts";
import type {
  CreateTaskRequest,
  SchemaName,
  Task,
  TaskBoardSchemas,
  UpdateTaskRequest,
  User,
} from "./schemas/types.ts";

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
      only: ["index", "delete"],
    });

    this.post(
      "/tasks",
      (schema, request) => {
        const { task } = request.validated.body as CreateTaskRequest;
        return schema.tasks.create(task);
      },
      {
        status: 201,
        openapi: {
          operationId: "createTask",
          requestBody: schemas.createTaskRequest,
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: schemas.taskResponse,
                },
              },
              description: "Created task",
            },
          },
        },
      },
    );

    this.patch(
      "/tasks/:taskId",
      (schema, request) => {
        const task = schema.tasks.find(request.validated.parameters.path.taskId as string);

        if (!task) {
          throw new HttpError(404, `Task "${request.params.taskId}" was not found.`);
        }

        return task.update((request.validated.body as UpdateTaskRequest).task);
      },
      {
        openapi: {
          operationId: "updateTask",
          parameters: [
            {
              in: "path",
              name: "taskId",
              required: true,
              schema: schemas.id,
            },
          ],
          requestBody: schemas.updateTaskRequest,
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: schemas.taskResponse,
                },
              },
              description: "Updated task",
            },
          },
        },
      },
    );

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

server.get("/openapi.json", () =>
  Response.json(
    server.openApiDocument({
      description: `Generated from the ${schemaName} task-board contracts.`,
      title: "Kajo task board",
      version: "1.0.0",
    }),
  ),
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => server.shutdown());
}

function selectedSchema(): SchemaName {
  const selected = new URL(window.location.href).searchParams.get("schema");
  return selected === "arktype" || selected === "valibot" || selected === "zod" ? selected : "zod";
}
