import { describe, expect, test, vi } from "vite-plus/test";
import { createServer, type RequestLog } from "../src/index.ts";

describe("request logging", () => {
  test("reports handled requests to a typed logger", async () => {
    const entries: RequestLog[] = [];
    const server = createServer({
      intercept: false,
      logging: (entry) => entries.push(entry),
      routes() {
        this.namespace = "/api";
        this.get("/tasks/:id", { title: "Ship Kajo" });
      },
    });

    const response = await server.handle(
      new Request("https://example.test/api/tasks/1?status=available"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      method: "GET",
      params: { id: "1" },
      queryParams: { status: "available" },
      requestBody: "",
      response,
      route: "/api/tasks/:id",
      type: "handled",
      url: "https://example.test/api/tasks/1?status=available",
    });
    expect(entries[0]?.type === "handled" && entries[0].durationMs).toEqual(expect.any(Number));
  });

  test("can toggle console logging after creating the server", async () => {
    const group = vi.spyOn(console, "groupCollapsed").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "groupEnd").mockImplementation(() => undefined);
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/tasks", []);
      },
    });

    await server.handle(new Request("https://example.test/tasks"));
    expect(group).not.toHaveBeenCalled();

    server.logging = true;
    await server.handle(new Request("https://example.test/tasks"));

    expect(group).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[Kajo\] 200 GET https:\/\/example\.test\/tasks → \/tasks \(\d+\.\dms\)$/,
      ),
    );
    expect(log).not.toHaveBeenCalledWith("Request body", expect.anything());
  });

  test("shows parsed JSON request bodies in console diagnostics", async () => {
    vi.spyOn(console, "groupCollapsed").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "groupEnd").mockImplementation(() => undefined);
    const server = createServer({
      intercept: false,
      logging: true,
      routes() {
        this.patch("/tasks/:id", {});
      },
    });

    await server.handle(
      new Request("https://example.test/tasks/1?source=browser", {
        body: JSON.stringify({ status: "done" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(log).toHaveBeenCalledWith("Request body", { status: "done" });
    expect(log).toHaveBeenCalledWith("Path parameters", { id: "1" });
    expect(log).toHaveBeenCalledWith("Query parameters", { source: "browser" });
  });

  test("reports route handler errors before rethrowing them", async () => {
    const entries: RequestLog[] = [];
    const failure = new Error("Handler failed");
    const server = createServer({
      intercept: false,
      logging: (entry) => entries.push(entry),
      routes() {
        this.post("/tasks", () => {
          throw failure;
        });
      },
    });

    await expect(
      server.handle(new Request("https://example.test/tasks", { method: "POST" })),
    ).rejects.toBe(failure);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      error: failure,
      method: "POST",
      requestBody: "",
      route: "/tasks",
      type: "error",
    });
  });

  test("does not let a custom logger break request handling", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("Logger failed");
    const server = createServer({
      intercept: false,
      logging() {
        throw failure;
      },
      routes() {
        this.get("/tasks", []);
      },
    });

    await expect(server.handle(new Request("https://example.test/tasks"))).resolves.toBeInstanceOf(
      Response,
    );
    expect(reported).toHaveBeenCalledWith("[Kajo] Request logger failed.", failure);
  });
});
