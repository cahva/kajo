import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createServer } from "../src/index.ts";

const kajoServers: { shutdown(): void }[] = [];

afterEach(() => {
  for (const server of kajoServers.splice(0)) {
    server.shutdown();
  }

  vi.unstubAllGlobals();
});

describe("request ownership", () => {
  test("defaults browser routes to the current origin", async () => {
    vi.stubGlobal("location", { origin: "https://app.example.test" });
    const server = createServer({
      intercept: false,
      routes() {
        this.get("/tasks", []);
      },
    });

    await expect(
      server.handle(new Request("https://app.example.test/tasks")),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      server.handle(new Request("https://unrelated.test/tasks")),
    ).resolves.toBeUndefined();
  });

  test("matches both the configured origin and API path", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.namespace = "/v1";
        this.get("/tasks", { source: "kajo" });
      },
      urlPrefix: "https://api.example.test/base",
    });

    const owned = await server.handle(new Request("https://api.example.test/base/v1/tasks"));

    await expect(owned?.json()).resolves.toEqual({ source: "kajo" });
    await expect(
      server.handle(new Request("https://unrelated.test/base/v1/tasks")),
    ).resolves.toBeUndefined();
    await expect(
      server.handle(new Request("https://api.example.test/v1/tasks")),
    ).resolves.toBeUndefined();
  });

  test("uses the urlPrefix active when each route is registered", async () => {
    const server = createServer({
      intercept: false,
      routes() {
        this.urlPrefix = "https://first.example.test";
        this.get("/first", { api: "first" });
        this.urlPrefix = "https://second.example.test";
        this.get("/second", { api: "second" });
      },
    });

    const first = await server.handle(new Request("https://first.example.test/first"));
    const second = await server.handle(new Request("https://second.example.test/second"));

    await expect(first?.json()).resolves.toEqual({ api: "first" });
    await expect(second?.json()).resolves.toEqual({ api: "second" });
    await expect(
      server.handle(new Request("https://second.example.test/first")),
    ).resolves.toBeUndefined();
  });

  test("validates urlPrefix when a route is registered", () => {
    expect(() =>
      createServer({
        intercept: false,
        routes() {
          this.urlPrefix = "/api";
          this.get("/tasks", []);
        },
      }),
    ).toThrow('The urlPrefix "/api" must be an absolute URL.');
  });
});

describe("intercepted request boundaries", () => {
  test("errors for unhandled owned requests but ignores other origins", async () => {
    const upstream = await startUpstream("outside kajo");
    const server = createServer({
      routes() {
        this.namespace = "/api";
        this.get("/tasks", []);
      },
      urlPrefix: "https://owned.example.test",
    });
    kajoServers.push(server);

    try {
      await expect(fetch("https://owned.example.test/api/missing")).rejects.toMatchObject({
        cause: {
          message:
            "Kajo intercepted an unhandled GET request to https://owned.example.test/api/missing. " +
            "Register a route or add an explicit passthrough rule.",
        },
      });

      const outside = await fetch(`${upstream.origin}/outside`);
      await expect(outside.text()).resolves.toBe("outside kajo");
    } finally {
      await upstream.close();
    }
  });

  test("passes matching rules through to the real network", async () => {
    const upstream = await startUpstream("upstream");

    try {
      const server = createServer({
        routes() {
          this.namespace = "/api";
          this.get("/mocked", { source: "kajo" });
          this.post("/real", { source: "kajo" });
          this.passthrough("/real", { methods: ["GET"] });
        },
        urlPrefix: upstream.origin,
      });
      kajoServers.push(server);

      const response = await fetch(`${upstream.origin}/api/real`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("upstream");

      const captured = await fetch(`${upstream.origin}/api/real`, { method: "POST" });
      await expect(captured.json()).resolves.toEqual({ source: "kajo" });
    } finally {
      await upstream.close();
    }
  });

  test("uses a catch-all passthrough only when no registered route matches", async () => {
    const upstream = await startUpstream("upstream");

    try {
      const server = createServer({
        routes() {
          this.namespace = "/api";
          this.get("/mocked", { source: "kajo" });
          this.passthrough();
        },
        urlPrefix: upstream.origin,
      });
      kajoServers.push(server);

      const captured = await fetch(`${upstream.origin}/api/mocked`);
      await expect(captured.json()).resolves.toEqual({ source: "kajo" });

      const passedThrough = await fetch(`${upstream.origin}/api/unhandled`);
      await expect(passedThrough.text()).resolves.toBe("upstream");
    } finally {
      await upstream.close();
    }
  });

  test("can bypass all unhandled requests inside an owned boundary", async () => {
    const upstream = await startUpstream("legacy API");

    try {
      const server = createServer({
        routes() {
          this.namespace = "/api";
          this.get("/mocked", { source: "kajo" });
        },
        unhandledRequest: "bypass",
        urlPrefix: upstream.origin,
      });
      kajoServers.push(server);

      const response = await fetch(`${upstream.origin}/api/legacy`);

      await expect(response.text()).resolves.toBe("legacy API");
    } finally {
      await upstream.close();
    }
  });
});

async function startUpstream(body: string): Promise<{
  close(): Promise<void>;
  origin: string;
}> {
  const server = createHttpServer((_request, response) => {
    response.end(body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
    origin: `http://127.0.0.1:${port}`,
  };
}
