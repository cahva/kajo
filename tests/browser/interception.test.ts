/// <reference lib="dom" />

import { expect, test } from "vite-plus/test";
import * as z from "zod";
import { createServer } from "../../src/index.ts";
import { createAjvOpenApiValidator } from "../../src/openapi/ajv.ts";

test("intercepts Fetch and XMLHttpRequest in a real browser", async () => {
  const server = createServer({
    openapiValidator: createAjvOpenApiValidator(),
    routes() {
      this.namespace = "/api";
      this.get("/fetch/:id", (_schema, request) => ({
        id: request.params.id,
        transport: "fetch",
      }));
      this.post("/xhr", (_schema, request) => ({
        body: JSON.parse(request.requestBody),
        transport: "xhr",
      }));
      this.post("/validated", (_schema, request) => Response.json(request.validated.body), {
        openapi: {
          operationId: "validateBrowserRequest",
          requestBody: z.object({
            count: z.coerce.number().int().positive(),
          }),
          responses: {
            "200": { description: "Validated body" },
          },
        },
      });
      this.post("/plain-validated", (_schema, request) => Response.json(request.validated.body), {
        openapi: {
          operationId: "validatePlainBrowserRequest",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: { count: { minimum: 1, type: "integer" } },
                  required: ["count"],
                  type: "object",
                },
              },
            },
            required: true,
          },
          responses: {
            "200": { description: "Validated body" },
          },
        },
      });
    },
  });

  try {
    const fetchResponse = await fetch("/api/fetch/task%201");
    await expect(fetchResponse.json()).resolves.toEqual({
      id: "task 1",
      transport: "fetch",
    });

    const xhrResponse = await sendXmlHttpRequest("/api/xhr", {
      status: "done",
    });
    expect(xhrResponse.status).toBe(200);
    expect(JSON.parse(xhrResponse.body)).toEqual({
      body: { status: "done" },
      transport: "xhr",
    });

    const valid = await fetch("/api/validated", {
      body: JSON.stringify({ count: "2" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await expect(valid.json()).resolves.toEqual({ count: 2 });

    const invalid = await fetch("/api/validated", {
      body: JSON.stringify({ count: 0 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: "OpenAPI request validation failed.",
      operationId: "validateBrowserRequest",
    });

    const invalidPlainSchema = await fetch("/api/plain-validated", {
      body: JSON.stringify({ count: 0 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalidPlainSchema.status).toBe(400);
    await expect(invalidPlainSchema.json()).resolves.toMatchObject({
      error: "OpenAPI request validation failed.",
      operationId: "validatePlainBrowserRequest",
    });
  } finally {
    server.shutdown();
  }
});

function sendXmlHttpRequest(
  url: string,
  body: unknown,
): Promise<{ readonly body: string; readonly status: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("content-type", "application/json");
    request.addEventListener("load", () => {
      resolve({
        body: request.responseText,
        status: request.status,
      });
    });
    request.addEventListener("error", () => {
      reject(new Error(`XMLHttpRequest to ${url} failed.`));
    });
    request.send(JSON.stringify(body));
  });
}
