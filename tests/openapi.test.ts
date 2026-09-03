import { describe, expect, test } from "vite-plus/test";
import { compileOpenApiRoutes, createServer, type OpenApiDocument } from "../src/index.ts";

const document = {
  info: {
    title: "Task API",
    version: "1.0.0",
  },
  openapi: "3.1.0",
  paths: {
    "/tasks": {
      post: {
        operationId: "createTask",
        responses: {
          "201": {
            content: {
              "application/json": {
                example: { id: "1", title: "Ship OpenAPI" },
              },
            },
            description: "Created task",
          },
        },
      },
    },
    "/tasks/{taskId}": {
      get: {
        operationId: "getTask",
        responses: {
          "200": {
            content: {
              "application/json": {
                examples: {
                  second: { value: { id: "2", title: "Second" } },
                  first: { value: { id: "1", title: "First" } },
                },
              },
              "text/plain": {
                example: "fallback",
              },
            },
            description: "A task",
          },
        },
      },
    },
  },
} as const satisfies OpenApiDocument;

describe("OpenAPI", () => {
  test("registers example-backed operations and converts path parameters", async () => {
    const server = createServer({
      intercept: false,
      openapi: document,
    });

    const getResponse = await server.handle(new Request("https://example.test/tasks/task%201"));
    const postResponse = await server.handle(
      new Request("https://example.test/tasks", { method: "POST" }),
    );

    expect(getResponse?.status).toBe(200);
    expect(getResponse?.headers.get("content-type")).toBe("application/json");
    await expect(getResponse?.json()).resolves.toEqual({ id: "1", title: "First" });
    expect(postResponse?.status).toBe(201);
    await expect(postResponse?.json()).resolves.toEqual({
      id: "1",
      title: "Ship OpenAPI",
    });
  });

  test("lets explicit Kajo routes override generated operations", async () => {
    const server = createServer({
      intercept: false,
      openapi: document,
      routes() {
        this.get("/tasks/:taskId", (_schema, request) => ({
          id: request.params.taskId,
          source: "handler",
        }));
      },
    });

    const response = await server.handle(new Request("https://example.test/tasks/42"));

    await expect(response?.json()).resolves.toEqual({
      id: "42",
      source: "handler",
    });
  });

  test("supports loading additional documents after construction", async () => {
    const server = createServer({ intercept: false });

    server.loadOpenApi(document);
    const response = await server.handle(new Request("https://example.test/tasks/1"));

    await expect(response?.json()).resolves.toEqual({ id: "1", title: "First" });
  });

  test("resolves local path, response, example, and schema references", async () => {
    const server = createServer({
      intercept: false,
      openapi: {
        components: {
          examples: {
            "task/example": {
              value: { id: "1", title: "Referenced" },
            },
          },
          pathItems: {
            Task: {
              get: {
                operationId: "getReferencedTask",
                responses: {
                  "200": { $ref: "#/components/responses/TaskAlias" },
                },
              },
            },
            TaskFromSchema: {
              get: {
                operationId: "getSchemaTask",
                responses: {
                  "200": {
                    content: {
                      "application/json": {
                        schema: { $ref: "#/components/schemas/TaskExample" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            Task: {
              content: {
                "application/json": {
                  examples: {
                    task: { $ref: "#/components/examples/task~1example" },
                  },
                },
              },
            },
            TaskAlias: { $ref: "#/components/responses/Task" },
          },
          schemas: {
            TaskExample: {
              example: { id: "2", title: "Schema example" },
            },
          },
        },
        openapi: "3.1.0",
        paths: {
          "/schema-task": { $ref: "#/components/pathItems/TaskFromSchema" },
          "/tasks/{taskId}": { $ref: "#/components/pathItems/Task" },
        },
      },
    });

    const exampleResponse = await server.handle(new Request("https://example.test/tasks/1"));
    const schemaResponse = await server.handle(new Request("https://example.test/schema-task"));

    await expect(exampleResponse?.json()).resolves.toEqual({
      id: "1",
      title: "Referenced",
    });
    await expect(schemaResponse?.json()).resolves.toEqual({
      id: "2",
      title: "Schema example",
    });
  });

  test("rejects unsupported versions, invalid templates, and references clearly", () => {
    expect(() =>
      compileOpenApiRoutes({
        openapi: "3.0.3",
        paths: {},
      }),
    ).toThrow('Kajo supports OpenAPI 3.1 documents; received version "3.0.3".');
    expect(() =>
      compileOpenApiRoutes({
        openapi: "3.1.0",
        paths: {
          "tasks/{id}": {
            get: { responses: { "200": { description: "Task" } } },
          },
        },
      }),
    ).toThrow('OpenAPI path "tasks/{id}" must start with "/".');
    expect(() =>
      compileOpenApiRoutes({
        openapi: "3.1.0",
        paths: {
          "/tasks": {
            get: {
              operationId: "getTasks",
              responses: {
                "200": { $ref: "./responses.yaml#/Tasks" },
              },
            },
          },
        },
      }),
    ).toThrow(
      'External OpenAPI $ref is not supported at response for "getTasks": "./responses.yaml#/Tasks".',
    );
    expect(() =>
      compileOpenApiRoutes({
        openapi: "3.1.0",
        paths: {
          "/tasks": { $ref: "#/components/pathItems/Missing" },
        },
      }),
    ).toThrow(
      'OpenAPI $ref at path item "/tasks" does not exist: "#/components/pathItems/Missing".',
    );
    expect(() =>
      compileOpenApiRoutes({
        components: {
          responses: {
            First: { $ref: "#/components/responses/Second" },
            Second: { $ref: "#/components/responses/First" },
          },
        },
        openapi: "3.1.0",
        paths: {
          "/tasks": {
            get: {
              responses: {
                "200": { $ref: "#/components/responses/First" },
              },
            },
          },
        },
      }),
    ).toThrow(
      'Circular OpenAPI $ref at response for "GET /tasks": "#/components/responses/First".',
    );
  });
});
