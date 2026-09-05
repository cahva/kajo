import petstore from "@readme/oas-examples/3.1/json/petstore.json" with { type: "json" };
import { describe, expect, test } from "vite-plus/test";
import {
  compileOpenApiRoutes,
  createServer,
  model,
  type OpenApiDocument,
} from "../../src/index.ts";

describe("OpenAPI Petstore compatibility", () => {
  test("compiles every operation in the OpenAPI 3.1 document", async () => {
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

  test("connects an operation to Kajo data at its documented server URL", async () => {
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
});
