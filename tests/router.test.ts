import { describe, expect, test } from "vite-plus/test";
import { createServer } from "../src/index.ts";

describe("route matching", () => {
  test("captures a decoded path with a named wildcard", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/files/*path", (_schema, request) => ({
          path: request.params.path,
        }));
      },
    });

    const response = await server.handle(
      new Request("https://example.test/files/guides/hello%20world/setup"),
    );

    await expect(response?.json()).resolves.toEqual({
      path: "guides/hello world/setup",
    });
    await expect(server.handle(new Request("https://example.test/files"))).resolves.toBeUndefined();
  });

  test("decodes static route and request segments", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/caf%C3%A9/menu", { matched: true });
        this.get("/naïve/menu", { literal: true });
      },
    });

    const response = await server.handle(new Request("https://example.test/caf%C3%A9/menu"));
    const literal = await server.handle(new Request("https://example.test/na%C3%AFve/menu"));

    await expect(response?.json()).resolves.toEqual({ matched: true });
    await expect(literal?.json()).resolves.toEqual({ literal: true });
  });

  test("ignores trailing slashes consistently", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/tasks/", { matched: true });
      },
    });

    await expect(server.handle(new Request("https://example.test/tasks"))).resolves.toBeInstanceOf(
      Response,
    );
    await expect(
      server.handle(new Request("https://example.test/tasks///")),
    ).resolves.toBeInstanceOf(Response);
  });

  test("prefers static routes, then parameters, then wildcards", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/files/*path", { route: "wildcard" });
        this.get("/files/:id", { route: "parameter" });
        this.get("/files/new", { route: "static" });
      },
    });

    await expect(
      (await server.handle(new Request("https://example.test/files/new")))?.json(),
    ).resolves.toEqual({ route: "static" });
    await expect(
      (await server.handle(new Request("https://example.test/files/1")))?.json(),
    ).resolves.toEqual({ route: "parameter" });
    await expect(
      (await server.handle(new Request("https://example.test/files/a/b")))?.json(),
    ).resolves.toEqual({ route: "wildcard" });
  });

  test("compares specificity at the first differing segment", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/items/:id/edit", { route: "parameter-first" });
        this.get("/items/special/:action", { route: "static-first" });
      },
    });

    const response = await server.handle(new Request("https://example.test/items/special/edit"));

    await expect(response?.json()).resolves.toEqual({ route: "static-first" });
  });

  test("lets later registrations replace an equally specific route", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/tasks", { version: 1 });
        this.get("/tasks", { version: 2 });
      },
    });

    const response = await server.handle(new Request("https://example.test/tasks"));

    await expect(response?.json()).resolves.toEqual({ version: 2 });
  });

  test("does not throw for malformed request path encoding", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/files/:name", {});
      },
    });

    await expect(
      server.handle(new Request("https://example.test/files/%invalid")),
    ).resolves.toBeUndefined();
  });

  test("validates parameter and wildcard route definitions", () => {
    expect(() =>
      createServer({
        intercept: false,
        routes() {
          this.get("/files/*path/edit", {});
        },
      }),
    ).toThrow('The wildcard segment in route "/files/*path/edit" must be last.');
    expect(() =>
      createServer({
        intercept: false,
        routes() {
          this.get("/files/:", {});
        },
      }),
    ).toThrow('The parameter segment in route "/files/:" must have a name.');
    expect(() =>
      createServer({
        intercept: false,
        routes() {
          this.get("/files/:id/:id", {});
        },
      }),
    ).toThrow('Route "/files/:id/:id" contains duplicate parameter "id".');
    expect(() =>
      createServer({
        intercept: false,
        routes() {
          this.get("/files/%invalid", {});
        },
      }),
    ).toThrow('Route "/files/%invalid" contains invalid percent encoding.');
  });
});
