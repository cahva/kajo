import { expect, test } from "vite-plus/test";
import { createServer } from "../src/index.ts";

test("handles static JSON responses", async () => {
  const server = createServer({
    routes() {
      this.get("/movies", {
        movies: ["Interstellar", "Inception", "Dunkirk"],
      });
    },
  });

  const response = await server.handle(new Request("https://example.test/movies"));

  expect(response?.status).toBe(200);
  await expect(response?.json()).resolves.toEqual({
    movies: ["Interstellar", "Inception", "Dunkirk"],
  });
});

test("passes request details to handlers", async () => {
  const server = createServer({
    routes() {
      this.post("/movies/:id", (_schema, request) => ({
        body: request.requestBody,
        id: request.params.id,
        page: request.queryParams.page,
      }));
    },
  });

  const response = await server.handle(
    new Request("https://example.test/movies/movie%201?page=2", {
      body: JSON.stringify({ title: "Arrival" }),
      method: "POST",
    }),
  );

  await expect(response?.json()).resolves.toEqual({
    body: '{"title":"Arrival"}',
    id: "movie 1",
    page: "2",
  });
});

test("uses the namespace active when a route is registered", async () => {
  const server = createServer({
    routes() {
      this.namespace = "api";
      this.get("/movies", []);
    },
  });

  await expect(server.handle(new Request("https://example.test/movies"))).resolves.toBeUndefined();
  await expect(
    server.handle(new Request("https://example.test/api/movies")),
  ).resolves.toBeInstanceOf(Response);
});

test("prefers static paths over dynamic paths", async () => {
  const server = createServer({
    routes() {
      this.get("/movies/:id", (_schema, request) => ({
        id: request.params.id,
      }));
      this.get("/movies/new", { form: true });
    },
  });

  const response = await server.handle(new Request("https://example.test/movies/new"));

  await expect(response?.json()).resolves.toEqual({ form: true });
});

test("returns undefined for unmatched requests and after shutdown", async () => {
  const server = createServer({
    routes() {
      this.get("/movies", []);
    },
  });

  await expect(server.handle(new Request("https://example.test/people"))).resolves.toBeUndefined();

  server.shutdown();

  await expect(server.handle(new Request("https://example.test/movies"))).resolves.toBeUndefined();
});
