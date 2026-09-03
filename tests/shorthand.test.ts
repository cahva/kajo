import { describe, expect, test } from "vite-plus/test";
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
});
