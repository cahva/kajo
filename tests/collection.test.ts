import { describe, expect, test } from "vite-plus/test";
import { belongsTo, createServer, hasMany, model } from "../src/index.ts";

interface Movie {
  title: string;
  year: number;
}

describe("collections", () => {
  test("provides typed array-style helpers without mutating the source", () => {
    const server = createServer({
      fixtures: {
        movies: [
          { title: "Arrival", year: 2016 },
          { title: "Contact", year: 1997 },
          { title: "Interstellar", year: 2014 },
        ],
      },
      intercept: false,
      models: {
        movie: model<Movie>(),
      },
    });
    const movies = server.schema.movies.all();
    const arrival = server.schema.movies.find(1);

    expect(arrival).not.toBeNull();
    expect(movies.includes(arrival!)).toBe(true);
    expect(movies.filter((movie) => movie.year >= 2014).length).toBe(2);
    expect(movies.slice(0, 2).models.map(({ title }) => title)).toEqual(["Arrival", "Contact"]);
    expect(
      movies.sort((left, right) => left.year - right.year).models.map(({ title }) => title),
    ).toEqual(["Contact", "Interstellar", "Arrival"]);
    expect(movies.models.map(({ title }) => title)).toEqual(["Arrival", "Contact", "Interstellar"]);
    expect(movies.toString()).toBe("collection:movie(movie:1,movie:2,movie:3)");
  });

  test("updates, reloads, and destroys all models", () => {
    const server = createServer({
      fixtures: {
        movies: [
          { title: "Arrival", year: 2016 },
          { title: "Contact", year: 1997 },
        ],
      },
      intercept: false,
      models: {
        movie: model<Movie>(),
      },
    });
    const movies = server.schema.movies.all();

    expect(movies.update("year", 2026)).toBe(movies);
    expect(server.db.movies.where({ year: 2026 })).toHaveLength(2);

    server.db.movies.update(1, { title: "Arrival: Reloaded" });
    expect(movies.reload().models[0]?.title).toBe("Arrival: Reloaded");

    movies.destroy();
    expect(server.schema.movies.all().length).toBe(0);
  });

  test("mutates hasMany membership when the relationship collection is saved", () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<{ title: string }>().extend({
          author: belongsTo("user"),
        }),
        user: model<{ name: string }>().extend({
          posts: hasMany("post"),
        }),
      },
    });
    const user = server.schema.users.create({ name: "Ada" });
    const first = server.schema.posts.create({ author: user, title: "First" });
    const second = server.schema.posts.create({ title: "Second" });
    const third = server.schema.posts.create({ title: "Third" });
    const posts = user.posts;

    expect(posts.add(second).add(second).remove(first).save()).toBe(posts);
    expect(user.postIds).toEqual([second.id]);
    expect(first.author).toBeNull();
    expect(second.author?.id).toBe(user.id);

    posts.mergeCollection(server.schema.posts.find([third.id])).save();
    expect(user.postIds).toEqual([second.id, third.id]);
    expect(third.author?.id).toBe(user.id);

    posts.filter(({ id }) => id === second.id).save();
    expect(user.postIds).toEqual([second.id, third.id]);
  });

  test("rejects models and collections of a different type", () => {
    const server = createServer({
      intercept: false,
      models: {
        movie: model<Movie>(),
        user: model<{ name: string }>(),
      },
    });
    const movies = server.schema.movies.none();
    const user = server.schema.users.create({ name: "Ada" });

    expect(() => movies.add(user as never)).toThrow("Cannot add user:1 to collection:movie.");
    expect(() => movies.mergeCollection(server.schema.users.all() as never)).toThrow(
      "Cannot merge collection:user into collection:movie.",
    );
  });
});
