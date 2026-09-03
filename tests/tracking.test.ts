import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  createServer,
  type ErroredRequestLog,
  type HandledRequestLog,
  type PassthroughRequestLog,
  type RequestLog,
  type UnhandledRequestLog,
} from "../src/index.ts";

describe("request tracking", () => {
  test("is disabled by default", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/tasks", []);
      },
    });

    await server.handle(new Request("https://example.test/tasks"));

    expect(server.requestHistory).toEqual([]);
    expect(server.handledRequests).toEqual([]);
  });

  test("retains typed handled requests independently from logging", async () => {
    const server = createServer({
      intercept: false,
      trackRequests: true,
      routes() {
        this.patch("/tasks/:id", { status: "done" });
      },
    });

    await server.handle(
      new Request("https://example.test/tasks/1", {
        body: JSON.stringify({ status: "done" }),
        method: "PATCH",
      }),
    );

    expectTypeOf(server.requestHistory).toEqualTypeOf<readonly RequestLog[]>();
    expectTypeOf(server.handledRequests).toEqualTypeOf<readonly HandledRequestLog[]>();
    expectTypeOf(server.passthroughRequests).toEqualTypeOf<readonly PassthroughRequestLog[]>();
    expectTypeOf(server.unhandledRequests).toEqualTypeOf<readonly UnhandledRequestLog[]>();
    expectTypeOf(server.erroredRequests).toEqualTypeOf<readonly ErroredRequestLog[]>();
    expect(server.handledRequests).toMatchObject([
      {
        method: "PATCH",
        requestBody: '{"status":"done"}',
        route: "/tasks/:id",
        type: "handled",
      },
    ]);
    expect(server.requestHistory).toEqual(server.handledRequests);
  });

  test("tracks route errors and can clear all history", async () => {
    const failure = new Error("Handler failed");
    const server = createServer({
      intercept: false,
      trackRequests: true,
      routes() {
        this.get("/tasks", () => {
          throw failure;
        });
      },
    });

    await expect(server.handle(new Request("https://example.test/tasks"))).rejects.toBe(failure);

    expect(server.erroredRequests).toMatchObject([
      {
        error: failure,
        route: "/tasks",
        type: "error",
      },
    ]);
    expect(server.requestHistory).toEqual(server.erroredRequests);

    server.clearRequestHistory();

    expect(server.requestHistory).toEqual([]);
    expect(server.erroredRequests).toEqual([]);
  });
});
