import { describe, expect, test } from "vite-plus/test";
import { createServer, type OpenApiDocument } from "../../src/index.ts";
import { createAjvOpenApiValidator } from "../../src/openapi/ajv.ts";

const document = {
  components: {
    schemas: {
      Category: {
        properties: {
          label: { minLength: 1, type: "string" },
        },
        required: ["label"],
        type: "object",
      },
      Pet: {
        properties: {
          category: { $ref: "#/components/schemas/Category" },
          contact: { format: "email", type: "string" },
          name: { minLength: 1, type: "string" },
        },
        required: ["category", "contact", "name"],
        type: "object",
      },
    },
  },
  openapi: "3.1.0",
  paths: {
    "/pets/{petId}": {
      put: {
        operationId: "updatePet",
        parameters: [
          {
            in: "path",
            name: "petId",
            required: true,
            schema: { minimum: 1, type: "integer" },
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Pet" },
            },
          },
          required: true,
        },
        responses: { "204": { description: "Updated" } },
      },
    },
  },
} as const satisfies OpenApiDocument;

describe("Ajv OpenAPI validator", () => {
  test("validates decoded parameters and nested local request references", async () => {
    const server = createServer({
      intercept: false,
      openapi: document,
      openapiHandlers: {
        updatePet: (_schema, request) => Response.json(request.validated),
      },
      openapiValidator: createAjvOpenApiValidator(),
    });

    const valid = await server.handle(
      new Request("https://example.test/pets/7", {
        body: JSON.stringify({
          category: { label: "mocked" },
          contact: "pet@example.com",
          name: "Kajo",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    const invalid = await server.handle(
      new Request("https://example.test/pets/0", {
        body: JSON.stringify({
          category: {},
          contact: "not-an-email",
          name: "",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );

    await expect(valid?.json()).resolves.toMatchObject({
      body: { name: "Kajo" },
      parameters: { path: { petId: 7 } },
    });
    expect(invalid?.status).toBe(400);
    const payload = (await invalid?.json()) as {
      error: string;
      issues: { path: readonly (number | string)[] }[];
      operationId: string;
    };
    expect(payload).toMatchObject({
      error: "OpenAPI request validation failed.",
      operationId: "updatePet",
    });
    expect(payload.issues.map(({ path }) => path)).toEqual(
      expect.arrayContaining([[], ["category", "label"], ["contact"], ["name"]]),
    );
  });
});
