import petstore from "@readme/oas-examples/3.1/json/petstore.json" with { type: "json" };
import { describe, expect, test } from "vite-plus/test";
import { type as arkType } from "arktype";
import * as z from "zod";
import {
  compileOpenApiRoutes,
  createServer,
  model,
  type OpenApiDocument,
  type OpenApiPathItem,
  type OpenApiReference,
  type OpenApiRequestBody,
  type OpenApiSchema,
} from "../src/index.ts";

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

function schemaOperation(
  operationId: string,
  schema: OpenApiSchema | OpenApiReference | boolean,
): OpenApiPathItem {
  return {
    get: {
      operationId,
      responses: {
        "200": {
          content: { "application/json": { schema } },
          description: "Generated",
        },
      },
    },
  };
}

describe("OpenAPI", () => {
  test("compiles every operation in the OpenAPI 3.1 Petstore document", async () => {
    const petstoreDocument = petstore as unknown as OpenApiDocument;
    const routes = compileOpenApiRoutes(petstoreDocument);

    expect(routes).toHaveLength(20);
    expect(routes.map(({ operationId }) => operationId)).toContain("getPetById");
    expect(routes.find(({ operationId }) => operationId === "addPet")?.response.status).toBe(405);

    const generated = routes.find(({ operationId }) => operationId === "getPetById")?.response;
    expect(generated?.status).toBe(200);
    expect(generated?.headers.get("content-type")).toBe("application/json");
    await expect(generated?.json()).resolves.toMatchObject({
      id: 0,
      name: "doggie",
      status: "available",
    });
  });

  test("connects a Petstore operation to Kajo data at its documented server URL", async () => {
    const server = createServer({
      fixtures: {
        pets: [{ id: 7, name: "Kajo", status: "available" }],
      },
      intercept: false,
      models: {
        pet: model<{ name: string; status: string }>(),
      },
      openapi: petstore as unknown as OpenApiDocument,
      openapiHandlers: {
        getPetById: (schema, request) => schema.pets.find(request.params.petId),
      },
      urlPrefix: petstore.servers[0]!.url,
    });

    const response = await server.handle(new Request("http://petstore.swagger.io/v2/pet/7"));

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      pet: {
        id: "7",
        name: "Kajo",
        status: "available",
      },
    });
  });

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
      openapiHandlers: {
        getTask: () => ({ source: "operation handler" }),
      },
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

  test("uses operationId handlers with seeded Kajo data", async () => {
    const server = createServer({
      fixtures: {
        tasks: [
          { id: "1", title: "First seeded task" },
          { id: "2", title: "Second seeded task" },
        ],
      },
      intercept: false,
      models: {
        task: model<{ title: string }>(),
      },
      openapi: document,
      openapiHandlers: {
        getTask: (schema, request) => schema.tasks.find(request.params.taskId),
      },
    });

    const handled = await server.handle(new Request("https://example.test/tasks/2"));
    const generated = await server.handle(
      new Request("https://example.test/tasks", { method: "POST" }),
    );

    await expect(handled?.json()).resolves.toEqual({
      task: {
        id: "2",
        title: "Second seeded task",
      },
    });
    await expect(generated?.json()).resolves.toEqual({
      id: "1",
      title: "Ship OpenAPI",
    });
  });

  test("validates operation handler names and registry identities atomically", async () => {
    const server = createServer({ intercept: false });

    expect(() =>
      server.loadOpenApi(document, {
        missingOperation: () => null,
      }),
    ).toThrow('No OpenAPI operation with operationId "missingOperation" was found.');

    server.loadOpenApi(document);
    await expect(
      server.handle(new Request("https://example.test/tasks/1")),
    ).resolves.toBeInstanceOf(Response);
    expect(() => server.loadOpenApi(document)).toThrow(
      'OpenAPI operation "POST /tasks" is already registered.',
    );

    expect(() =>
      createServer({
        intercept: false,
        openapi: {
          openapi: "3.1.0",
          paths: {
            "/first": {
              get: {
                operationId: "duplicate",
                responses: { "204": { description: "Done" } },
              },
            },
            "/second": {
              get: {
                operationId: "duplicate",
                responses: { "204": { description: "Done" } },
              },
            },
          },
        },
      }),
    ).toThrow('OpenAPI operationId "duplicate" is already registered.');
  });

  test("generates stable operationIds when the document omits them", () => {
    const [route] = compileOpenApiRoutes({
      openapi: "3.1.0",
      paths: {
        "/tasks/{taskId}/comments": {
          get: {
            responses: { "204": { description: "Done" } },
          },
        },
      },
    });

    expect(route?.operationId).toBe("getTasksTaskIdComments");
  });

  test("exports Kajo route contracts with Standard Schema responses", async () => {
    const Task = z.object({
      id: z.string(),
      title: z.string().min(1),
    });
    const server = createServer({
      intercept: false,
      routes() {
        this.namespace = "/api";
        this.get(
          "/tasks/:taskId",
          (_schema, request) => ({
            id: request.params.taskId,
            title: "Contracted task",
          }),
          {
            openapi: {
              operationId: "getTask",
              responses: {
                "200": {
                  content: {
                    "application/json": {
                      schema: Task,
                    },
                  },
                  description: "A task",
                },
              },
            },
          },
        );
      },
    });

    const response = await server.handle(new Request("https://example.test/api/tasks/42"));
    const exported = server.openApiDocument({
      title: "Task API",
      version: "1.0.0",
    });

    await expect(response?.json()).resolves.toEqual({
      id: "42",
      title: "Contracted task",
    });
    expect(exported).toMatchObject({
      info: {
        title: "Task API",
        version: "1.0.0",
      },
      openapi: "3.1.0",
      paths: {
        "/api/tasks/{taskId}": {
          get: {
            operationId: "getTask",
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      properties: {
                        id: { type: "string" },
                        title: { minLength: 1, type: "string" },
                      },
                      required: ["id", "title"],
                      type: "object",
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(exported)).not.toContain("~standard");
  });

  test("merges Kajo contracts into an imported document using route precedence", async () => {
    const server = createServer({
      intercept: false,
      openapi: {
        ...document,
        "x-origin": "backend",
      },
      routes() {
        this.get("/tasks/:taskId", () => ({ source: "kajo" }), {
          openapi: {
            operationId: "findTask",
            responses: {
              "200": {
                content: {
                  "application/json": {
                    example: { source: "kajo" },
                  },
                },
                description: "Kajo task",
              },
            },
          },
        });
      },
    });

    const response = await server.handle(new Request("https://example.test/tasks/1"));
    const exported = server.openApiDocument();

    await expect(response?.json()).resolves.toEqual({ source: "kajo" });
    expect(exported.info).toEqual(document.info);
    expect(exported["x-origin"]).toBe("backend");
    expect((exported.paths["/tasks/{taskId}"] as OpenApiPathItem).get?.operationId).toBe(
      "findTask",
    );
    expect((exported.paths["/tasks"] as OpenApiPathItem).post?.operationId).toBe("createTask");
  });

  test("requires export metadata and rejects wildcard contracts", () => {
    const server = createServer({ intercept: false });

    expect(() => server.openApiDocument()).toThrow(
      "OpenAPI export requires an info object with a title and version.",
    );
    expect(() =>
      createServer({
        intercept: false,
        routes() {
          this.get("/files/*path", [], {
            openapi: {
              operationId: "getFile",
              responses: { "200": { description: "File" } },
            },
          });
        },
      }),
    ).toThrow('OpenAPI route contract "/files/*path" cannot contain a wildcard.');
  });

  test("validates and transforms Standard Schema request bodies", async () => {
    const CreateTask = z.object({
      priority: z.coerce.number().int().min(1),
      title: z.string().min(1),
    });
    const server = createServer({
      intercept: false,
      routes() {
        this.post(
          "/tasks",
          (_schema, request) => Response.json({ received: request.validated.body }),
          {
            openapi: {
              operationId: "createTask",
              requestBody: CreateTask,
              responses: {
                "200": { description: "Created task" },
              },
            },
          },
        );
      },
    });

    const valid = await server.handle(
      new Request("https://example.test/tasks", {
        body: JSON.stringify({ priority: "2", title: "Validated" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const invalid = await server.handle(
      new Request("https://example.test/tasks", {
        body: JSON.stringify({ priority: 0, title: "" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    await expect(valid?.json()).resolves.toEqual({
      received: { priority: 2, title: "Validated" },
    });
    expect(invalid?.status).toBe(400);
    await expect(invalid?.json()).resolves.toMatchObject({
      error: "OpenAPI request validation failed.",
      issues: [
        { location: "body", path: ["priority"] },
        { location: "body", path: ["title"] },
      ],
      operationId: "createTask",
    });
    const exported = server.openApiDocument({ title: "Tasks", version: "1.0.0" });
    const requestBody = (exported.paths["/tasks"] as OpenApiPathItem).post
      ?.requestBody as OpenApiRequestBody;
    expect(requestBody).toMatchObject({
      content: {
        "application/json": {
          schema: {
            properties: {
              priority: { type: "integer" },
              title: { minLength: 1, type: "string" },
            },
            required: ["priority", "title"],
            type: "object",
          },
        },
      },
      required: true,
    });
    expect(JSON.stringify(requestBody)).not.toContain("~standard");
  });

  test("accepts callable Standard Schema request contracts", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.post("/tasks", () => undefined, {
          openapi: {
            operationId: "createTask",
            requestBody: arkType({ title: "string > 0" }),
            responses: {
              "204": { description: "Created task" },
            },
          },
        });
      },
    });

    const valid = await server.handle(
      new Request("https://example.test/tasks", {
        body: JSON.stringify({ title: "ArkType contract" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const invalid = await server.handle(
      new Request("https://example.test/tasks", {
        body: JSON.stringify({ title: "" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(valid?.status).toBe(204);
    expect(invalid?.status).toBe(400);
  });

  test("validates path, query, header, and cookie parameters", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get(
          "/tasks/:taskId",
          (_schema, request) => Response.json(request.validated.parameters),
          {
            openapi: {
              operationId: "getTask",
              parameters: [
                {
                  in: "path",
                  name: "taskId",
                  required: true,
                  schema: z.coerce.number().int().positive(),
                },
                {
                  explode: false,
                  in: "query",
                  name: "tag",
                  schema: z.array(z.string()),
                },
                {
                  in: "header",
                  name: "x-mode",
                  required: true,
                  schema: z.literal("preview"),
                },
                {
                  in: "cookie",
                  name: "session",
                  schema: z.string().min(1),
                },
              ],
              responses: {
                "200": { description: "Task parameters" },
              },
            },
          },
        );
      },
    });

    const valid = await server.handle(
      new Request("https://example.test/tasks/42?tag=api,typed", {
        headers: {
          cookie: "session=abc123; theme=dark",
          "x-mode": "preview",
        },
      }),
    );
    const missing = await server.handle(new Request("https://example.test/tasks/42?tag=api,typed"));

    await expect(valid?.json()).resolves.toEqual({
      cookie: { session: "abc123" },
      header: { "x-mode": "preview" },
      path: { taskId: 42 },
      query: { tag: ["api", "typed"] },
    });
    expect(missing?.status).toBe(400);
    await expect(missing?.json()).resolves.toMatchObject({
      issues: [
        {
          location: "header",
          message: 'Required header parameter "x-mode" is missing.',
          name: "x-mode",
        },
      ],
      operationId: "getTask",
    });
  });

  test("reports malformed JSON before invoking the contracted handler", async () => {
    let handled = false;
    const server = createServer({
      intercept: false,
      routes() {
        this.post(
          "/tasks",
          () => {
            handled = true;
            return null;
          },
          {
            openapi: {
              operationId: "createTask",
              requestBody: z.object({ title: z.string() }),
              responses: {
                "204": { description: "Created" },
              },
            },
          },
        );
      },
    });

    const response = await server.handle(
      new Request("https://example.test/tasks", {
        body: "{",
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const wrongContentType = await server.handle(
      new Request("https://example.test/tasks", {
        body: JSON.stringify({ title: "Wrong content type" }),
        headers: { "content-type": "text/plain" },
        method: "POST",
      }),
    );

    expect(handled).toBe(false);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      issues: [{ location: "body", message: "Request body is not valid JSON." }],
    });
    expect(wrongContentType?.status).toBe(400);
    await expect(wrongContentType?.json()).resolves.toMatchObject({
      issues: [
        {
          location: "body",
          message: 'Content type "text/plain" is not declared by this operation.',
        },
      ],
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

  test("generates deterministic bodies from response schemas", async () => {
    const server = createServer({
      intercept: false,
      openapi: {
        components: {
          schemas: {
            Owner: {
              properties: {
                email: { format: "email", type: "string" },
                id: { format: "uuid", type: "string" },
              },
              type: "object",
            },
          },
        },
        openapi: "3.1.0",
        paths: {
          "/report": {
            get: {
              operationId: "getReport",
              responses: {
                "200": {
                  content: {
                    "application/json": {
                      schema: {
                        properties: {
                          active: { type: "boolean" },
                          attachments: { type: "array" },
                          count: { minimum: 3, type: "integer" },
                          createdAt: { format: "date-time", type: "string" },
                          note: { type: "null" },
                          owner: { $ref: "#/components/schemas/Owner" },
                          score: { exclusiveMinimum: 0.5, type: "number" },
                          tags: { items: { type: "string" }, type: "array" },
                          title: { type: "string" },
                        },
                        type: "object",
                      },
                    },
                  },
                  description: "Report",
                },
              },
            },
          },
          "/report/plain": {
            get: {
              operationId: "getPlainReport",
              responses: {
                "200": {
                  content: {
                    "text/plain": {
                      schema: { type: "string" },
                    },
                  },
                  description: "Plain report",
                },
              },
            },
          },
        },
      } as const satisfies OpenApiDocument,
    });

    const jsonResponse = await server.handle(new Request("https://example.test/report"));
    const plainResponse = await server.handle(new Request("https://example.test/report/plain"));

    expect(jsonResponse?.status).toBe(200);
    expect(jsonResponse?.headers.get("content-type")).toBe("application/json");
    await expect(jsonResponse?.json()).resolves.toEqual({
      active: true,
      attachments: [],
      count: 3,
      createdAt: "2024-01-01T00:00:00Z",
      note: null,
      owner: {
        email: "user@example.com",
        id: "00000000-0000-0000-0000-000000000000",
      },
      score: 1.5,
      tags: ["string"],
      title: "string",
    });
    expect(plainResponse?.headers.get("content-type")).toBe("text/plain");
    await expect(plainResponse?.text()).resolves.toBe("string");
  });

  test("prefers schema value keywords over synthesis", async () => {
    const server = createServer({
      intercept: false,
      openapi: {
        openapi: "3.1.0",
        paths: {
          "/const": schemaOperation("getConst", { const: "const", default: "default" }),
          "/default": schemaOperation("getDefault", { default: "asc", enum: ["desc", "asc"] }),
          "/enum": schemaOperation("getEnum", { enum: ["desc", "asc"] }),
          "/example": schemaOperation("getExample", { const: "const", example: "example" }),
          "/examples": schemaOperation("getExamples", { const: "const", examples: ["annotated"] }),
        },
      } as const satisfies OpenApiDocument,
    });

    const bodies = await Promise.all(
      ["const", "default", "enum", "example", "examples"].map(async (path) => {
        const response = await server.handle(new Request(`https://example.test/${path}`));
        return response?.json();
      }),
    );

    expect(bodies).toEqual(["const", "asc", "desc", "example", "annotated"]);
  });

  test("handles nullable type arrays and composition", async () => {
    const server = createServer({
      intercept: false,
      openapi: {
        openapi: "3.1.0",
        paths: {
          "/all-of": schemaOperation("getAllOf", {
            allOf: [
              { properties: { id: { type: "string" } }, type: "object" },
              {
                properties: { id: { const: "override" }, name: { type: "string" } },
                type: "object",
              },
            ],
          }),
          "/null-only": schemaOperation("getNullOnly", { type: ["null"] }),
          "/nullable": schemaOperation("getNullable", { type: ["string", "null"] }),
          "/one-of": schemaOperation("getOneOf", {
            oneOf: [{ type: "integer" }, { type: "string" }],
          }),
        },
      } as const satisfies OpenApiDocument,
    });

    const bodies = await Promise.all(
      ["all-of", "null-only", "nullable", "one-of"].map(async (path) => {
        const response = await server.handle(new Request(`https://example.test/${path}`));
        return response?.json();
      }),
    );

    expect(bodies).toEqual([{ id: "override", name: "string" }, null, "string", 0]);
  });

  test("generates placeholder bodies for unconstrained schemas", async () => {
    const server = createServer({
      intercept: false,
      openapi: {
        openapi: "3.1.0",
        paths: {
          "/any": schemaOperation("getAny", true),
          "/empty": schemaOperation("getEmpty", {}),
        },
      } as const satisfies OpenApiDocument,
    });

    const anyResponse = await server.handle(new Request("https://example.test/any"));
    const emptyResponse = await server.handle(new Request("https://example.test/empty"));

    expect(emptyResponse?.headers.get("content-type")).toBe("application/json");
    await expect(anyResponse?.json()).resolves.toEqual({});
    await expect(emptyResponse?.json()).resolves.toEqual({});
  });

  test("rejects recursive and impossible schemas clearly", () => {
    expect(() =>
      compileOpenApiRoutes({
        components: {
          schemas: {
            Node: {
              properties: {
                children: { items: { $ref: "#/components/schemas/Node" }, type: "array" },
              },
              type: "object",
            },
          },
        },
        openapi: "3.1.0",
        paths: {
          "/nodes": schemaOperation("getNode", { $ref: "#/components/schemas/Node" }),
        },
      }),
    ).toThrow('Recursive OpenAPI schema for "getNode" requires an explicit example.');
    expect(() =>
      compileOpenApiRoutes({
        components: {
          schemas: {
            Alias: { $ref: "#/components/schemas/Loop" },
            Loop: {
              properties: { next: { $ref: "#/components/schemas/Alias" } },
              type: "object",
            },
          },
        },
        openapi: "3.1.0",
        paths: {
          "/loops": schemaOperation("getLoop", { $ref: "#/components/schemas/Loop" }),
        },
      }),
    ).toThrow('Recursive OpenAPI schema for "getLoop" requires an explicit example.');
    expect(() =>
      compileOpenApiRoutes({
        openapi: "3.1.0",
        paths: {
          "/binary": schemaOperation("getBinary", { type: "binary" }),
        },
      }),
    ).toThrow('OpenAPI schema for "getBinary" has unsupported type "binary".');
    expect(() =>
      compileOpenApiRoutes({
        openapi: "3.1.0",
        paths: {
          "/nothing": schemaOperation("getNothing", false),
        },
      }),
    ).toThrow('OpenAPI schema for "getNothing" is "false" and permits no values.');
    expect(() =>
      compileOpenApiRoutes({
        openapi: "3.1.0",
        paths: {
          "/merge": schemaOperation("getMerge", {
            allOf: [{ properties: { id: { type: "string" } }, type: "object" }, { type: "string" }],
          }),
        },
      }),
    ).toThrow('OpenAPI schema for "getMerge" has an "allOf" that does not produce an object.');
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
