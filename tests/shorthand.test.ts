import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { createServer, model } from "../src/index.ts";

function createMovieServer() {
  return createServer({
    intercept: false,
    models: {
      movie: model<{ released?: boolean; title: string }>(),
    },
    routes() {
      this.get("/movies");
      this.get("/movies/:id");
      this.get("/films", "movies");
      this.post("/movies");
      this.patch("/movies/:id");
      this.put("/movies/:id");
      this.del("/movies/:id");
    },
    seeds(server) {
      server.schema.movies.create({ title: "Arrival" });
    },
  });
}

describe("route shorthands", () => {
  test("fetches collections and individual models", async () => {
    const server = createMovieServer();
    const collection = await server.handle(new Request("https://example.test/movies"));
    const modelResponse = await server.handle(new Request("https://example.test/movies/1"));

    expect(collection?.status).toBe(200);
    await expect(collection?.json()).resolves.toEqual({
      movies: [{ id: "1", title: "Arrival" }],
    });
    await expect(modelResponse?.json()).resolves.toEqual({
      movie: { id: "1", title: "Arrival" },
    });
  });

  test("supports an explicit collection name", async () => {
    const server = createMovieServer();
    const response = await server.handle(new Request("https://example.test/films"));

    await expect(response?.json()).resolves.toEqual({
      movies: [{ id: "1", title: "Arrival" }],
    });
  });

  test("creates models from rooted request JSON", async () => {
    const server = createMovieServer();
    const response = await server.handle(
      new Request("https://example.test/movies", {
        body: JSON.stringify({ movie: { title: "Interstellar" } }),
        method: "POST",
      }),
    );

    expect(response?.status).toBe(201);
    await expect(response?.json()).resolves.toEqual({
      movie: { id: "2", title: "Interstellar" },
    });
  });

  test("normalizes typed attributes for custom route handlers", async () => {
    const server = createServer({
      intercept: false,
      models: {
        movie: model<{ released?: boolean; title: string }>(),
      },
      routes() {
        this.post("/custom-movies", (schema, request) => {
          const attributes = this.normalizedRequestAttrs(request, "movie");
          expectTypeOf(attributes.title).toEqualTypeOf<string>();
          return schema.movies.create(attributes);
        });
      },
    });
    const rooted = await server.handle(
      new Request("https://example.test/custom-movies", {
        body: JSON.stringify({ movie: { title: "Contact" } }),
        method: "POST",
      }),
    );
    const unrooted = await server.handle(
      new Request("https://example.test/custom-movies", {
        body: JSON.stringify({ title: "Arrival" }),
        method: "POST",
      }),
    );

    await expect(rooted?.json()).resolves.toEqual({
      movie: { id: "1", title: "Contact" },
    });
    await expect(unrooted?.json()).resolves.toEqual({
      movie: { id: "2", title: "Arrival" },
    });
  });

  test.each([
    [
      "PATCH",
      new Request("https://example.test/movies/1", {
        body: JSON.stringify({ movie: { released: true } }),
        method: "PATCH",
      }),
    ],
    [
      "PUT",
      new Request("https://example.test/movies/1", {
        body: JSON.stringify({ movie: { released: true } }),
        method: "PUT",
      }),
    ],
  ])("updates models with the %s shorthand", async (_method, request) => {
    const server = createMovieServer();
    const response = await server.handle(request);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      movie: { id: "1", released: true, title: "Arrival" },
    });
  });

  test("deletes models with an empty 200 response", async () => {
    const server = createMovieServer();
    const response = await server.handle(
      new Request("https://example.test/movies/1", {
        method: "DELETE",
      }),
    );

    expect(response?.status).toBe(200);
    await expect(response?.text()).resolves.toBe("");
    expect(server.schema.movies.find("1")).toBeNull();
  });

  test("returns 404 responses when a model does not exist", async () => {
    const server = createMovieServer();
    const response = await server.handle(new Request("https://example.test/movies/missing"));

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({
      error: 'No movie with id "missing" was found.',
    });
  });

  test("returns 400 responses for malformed request JSON", async () => {
    const server = createMovieServer();
    const response = await server.handle(
      new Request("https://example.test/movies", {
        body: "{",
        method: "POST",
      }),
    );

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toEqual({
      error: "The POST request expected a JSON request body.",
    });
  });
});

describe("resource routes", () => {
  test("registers a complete CRUD resource", async () => {
    const server = createServer({
      intercept: false,
      models: {
        movie: model<{ title: string }>(),
      },
      routes() {
        this.resource("movies");
      },
      seeds(server) {
        server.schema.movies.create({ title: "Arrival" });
      },
    });

    const index = await server.handle(new Request("https://example.test/movies"));
    const created = await server.handle(
      new Request("https://example.test/movies", {
        body: JSON.stringify({ movie: { title: "Contact" } }),
        method: "POST",
      }),
    );
    const updated = await server.handle(
      new Request("https://example.test/movies/1", {
        body: JSON.stringify({ movie: { title: "Interstellar" } }),
        method: "PUT",
      }),
    );
    const deleted = await server.handle(
      new Request("https://example.test/movies/1", {
        method: "DELETE",
      }),
    );

    expect(index?.status).toBe(200);
    expect(created?.status).toBe(201);
    await expect(updated?.json()).resolves.toEqual({
      movie: { id: "1", title: "Interstellar" },
    });
    expect(deleted?.status).toBe(200);
  });

  test("supports action filters and custom paths", async () => {
    const server = createServer({
      intercept: false,
      models: {
        movie: model<{ title: string }>(),
      },
      routes() {
        this.resource("movies", {
          only: ["index", "show"],
          path: "/films",
        });
      },
    });

    await expect(server.handle(new Request("https://example.test/films"))).resolves.toBeInstanceOf(
      Response,
    );
    await expect(
      server.handle(new Request("https://example.test/films/1")),
    ).resolves.toBeInstanceOf(Response);
    await expect(
      server.handle(
        new Request("https://example.test/films", {
          method: "POST",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  test("supports except filters and rejects conflicting filters", async () => {
    const server = createServer({
      intercept: false,
      models: {
        movie: model<{ title: string }>(),
      },
      routes() {
        this.resource("movie", { except: ["delete"] });
      },
    });

    await expect(
      server.handle(
        new Request("https://example.test/movies/1", {
          method: "DELETE",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(() =>
      server.resource("movies", {
        except: ["delete"],
        only: ["index"],
      }),
    ).toThrow('Resource options cannot combine "only" and "except".');
  });
});
