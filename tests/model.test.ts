import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { createServer, model } from "../src/index.ts";

interface Movie {
  title: string;
  year: number;
}

describe("models", () => {
  test("creates typed model instances", () => {
    const server = createServer({
      intercept: false,
      models: {
        movie: model<Movie>(),
      },
    });

    const movie = server.schema.movies.create({
      title: "Arrival",
      year: 2016,
    });

    expectTypeOf(movie.title).toEqualTypeOf<string>();
    expect(movie.id).toBe("1");
    expect(movie.modelName).toBe("movie");
    expect(movie.attrs).toEqual({
      id: "1",
      title: "Arrival",
      year: 2016,
    });

    movie.title = "Contact";
    expect(movie.save().title).toBe("Contact");
    expect(server.db.movies.find(1)?.title).toBe("Contact");
  });

  test("queries, updates, and destroys model instances", () => {
    const server = createServer({
      fixtures: {
        movies: [{ title: "Arrival", year: 2016 }],
      },
      intercept: false,
      models: {
        movie: model<Movie>(),
      },
    });

    const movie = server.schema.movies.find(1);

    expect(movie).not.toBeNull();
    movie?.update({ title: "Interstellar", year: 2014 });
    expect(movie?.title).toBe("Interstellar");
    expect(server.schema.movies.findBy({ year: 2014 })?.id).toBe("1");
    expect(server.schema.movies.where({ title: "Interstellar" }).models[0]?.id).toBe("1");

    movie?.destroy();

    expect(movie?.isDestroyed).toBe(true);
    expect(server.schema.movies.find(1)).toBeNull();
    expect(() => movie?.reload()).toThrow("Cannot reload destroyed movie:1.");
  });

  test("pluralizes common model names", () => {
    const server = createServer({
      intercept: false,
      models: {
        box: model<{ label: string }>(),
        category: model<{ name: string }>(),
        match: model<{ name: string }>(),
        toy: model<{ name: string }>(),
      },
    });

    expect(server.schema.boxes.all().length).toBe(0);
    expect(server.schema.categories.all().length).toBe(0);
    expect(server.schema.matches.all().length).toBe(0);
    expect(server.schema.toys.all().length).toBe(0);
  });
});

test("serializes model collections returned from route handlers", async () => {
  const server = createServer({
    intercept: false,
    models: {
      movie: model<Movie>(),
    },
    routes() {
      this.get("/movies", (schema) => schema.movies.all());
      this.get("/movies/:id", (schema, request) => schema.movies.find(request.params.id));
    },
    seeds(server) {
      server.schema.movies.create({
        title: "Arrival",
        year: 2016,
      });
    },
  });

  const collectionResponse = await server.handle(new Request("https://example.test/movies"));
  const modelResponse = await server.handle(new Request("https://example.test/movies/1"));

  await expect(collectionResponse?.json()).resolves.toEqual([
    { id: "1", title: "Arrival", year: 2016 },
  ]);
  await expect(modelResponse?.json()).resolves.toEqual({
    id: "1",
    title: "Arrival",
    year: 2016,
  });
});
