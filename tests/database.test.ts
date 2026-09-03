import { describe, expect, test } from "vite-plus/test";
import { createDatabase, createServer, type IdentityManagerContract, model } from "../src/index.ts";

class PrefixedIdentityManager implements IdentityManagerContract {
  readonly #ids = new Set<string>();
  #nextId = 1;

  fetch(): string {
    let id = `test-${this.#nextId}`;

    while (this.#ids.has(id)) {
      this.#nextId += 1;
      id = `test-${this.#nextId}`;
    }

    this.#ids.add(id);
    this.#nextId += 1;
    return id;
  }

  set(id: number | string): void {
    const normalizedId = String(id);

    if (this.#ids.has(normalizedId)) {
      throw new Error(`Duplicate custom id "${normalizedId}".`);
    }

    this.#ids.add(normalizedId);
  }

  reset(): void {
    this.#ids.clear();
    this.#nextId = 1;
  }
}

describe("database collections", () => {
  test("loads records and assigns deterministic string ids", () => {
    const db = createDatabase({
      users: [{ id: 10, name: "Link" }, { name: "Zelda" }],
    });

    expect(db.users.length).toBe(2);
    expect(db.users[0]).toEqual({ id: "10", name: "Link" });
    expect(db.users[1]).toEqual({ id: "11", name: "Zelda" });
    expect(db.users.find(10)).toBe(db.users[0]);
    expect(db.users.find("missing")).toBeNull();
  });

  test("inserts one or many records", () => {
    const users = createDatabase({
      users: [{ name: "Link" }],
    }).users;

    expect(users.insert({ name: "Zelda" })).toEqual({
      id: "2",
      name: "Zelda",
    });
    expect(users.insert([{ name: "Epona" }, { name: "Ganon" }])).toEqual([
      { id: "3", name: "Epona" },
      { id: "4", name: "Ganon" },
    ]);
    expect([...users]).toHaveLength(4);
  });

  test("queries records using string comparisons", () => {
    const users = createDatabase({
      users: [
        { age: 17, name: "Link" },
        { age: 117, name: "Zelda" },
      ],
    }).users;

    expect(users.findBy({ name: "Link" })).toBe(users[0]);
    expect(users.where({ age: 117 })).toEqual([{ age: 117, id: "2", name: "Zelda" }]);
    expect(users.find([2, 1])).toEqual([users[1], users[0]]);
  });

  test("updates records by id, query, or all records", () => {
    const users = createDatabase({
      users: [
        { active: true, name: "Link" },
        { active: true, name: "Zelda" },
      ],
    }).users;

    expect(users.update(1, { name: "Young Link" })).toBe(users[0]);
    expect(users.update({ name: "Zelda" }, { active: false })).toEqual([users[1]]);
    expect(users.update({ active: true })).toEqual([users[0], users[1]]);
    expect([...users]).toEqual([
      { active: true, id: "1", name: "Young Link" },
      { active: true, id: "2", name: "Zelda" },
    ]);
  });

  test("removes records and resets identity state when emptied", () => {
    const db = createDatabase({
      users: [{ name: "Link" }, { name: "Zelda" }],
    });

    db.users.remove({ name: "Link" });
    expect([...db.users]).toEqual([{ id: "2", name: "Zelda" }]);

    db.emptyData();

    expect(db.users.length).toBe(0);
    expect(db.users.insert({ name: "Epona" }).id).toBe("1");
  });

  test("finds an existing record or creates it", () => {
    const users = createDatabase({
      users: [{ evil: false, name: "Link" }],
    }).users;

    expect(users.firstOrCreate({ name: "Link" })).toBe(users[0]);
    expect(users.firstOrCreate({ name: "Ganon" }, { evil: true })).toEqual({
      evil: true,
      id: "2",
      name: "Ganon",
    });
  });

  test("rejects duplicate ids", () => {
    const users = createDatabase({
      users: [{ id: "custom", name: "Link" }],
    }).users;

    expect(() => users.insert({ id: "custom", name: "Dark Link" })).toThrow(
      'The id "custom" is already in use.',
    );
  });

  test("uses and resets collection-specific identity managers", () => {
    const db = createDatabase(
      {
        users: [{ id: "imported", name: "Link" }],
      },
      {
        identityManagers: {
          users: PrefixedIdentityManager,
        },
      },
    );

    expect(db.users.insert({ name: "Zelda" }).id).toBe("test-1");
    expect(() => db.users.insert({ id: "imported", name: "Dark Link" })).toThrow(
      'The id "imported" is already in use.',
    );

    db.emptyData();

    expect(db.users.insert({ name: "Epona" }).id).toBe("test-1");
  });
});

test("server identity managers support application and per-model defaults", () => {
  const server = createServer({
    identityManagers: {
      application: PrefixedIdentityManager,
      movie: class extends PrefixedIdentityManager {
        override fetch(): string {
          return `movie-${super.fetch()}`;
        }
      },
    },
    intercept: false,
    models: {
      movie: model<{ title: string }>(),
      user: model<{ name: string }>(),
    },
  });

  expect(server.schema.movies.create({ title: "Arrival" }).id).toBe("movie-test-1");
  expect(server.schema.users.create({ name: "Ada" }).id).toBe("test-1");
});

test("server fixtures and seeds are available to route handlers", async () => {
  const server = createServer({
    fixtures: {
      movies: [{ title: "Arrival" }],
    },
    intercept: false,
    routes() {
      this.get("/movies/:id", (schema, request) => {
        return schema.db.movies.find(request.params.id) ?? undefined;
      });
    },
    seeds(server) {
      server.db.movies.insert({ title: "Interstellar" });
    },
  });

  const response = await server.handle(new Request("https://example.test/movies/2"));

  await expect(response?.json()).resolves.toEqual({
    id: "2",
    title: "Interstellar",
  });
});

test("reloads all or selected configured fixtures", () => {
  const server = createServer({
    fixtures: {
      movies: [{ title: "Arrival" }],
      users: [{ name: "Ada" }],
    },
    intercept: false,
  });

  server.db.emptyData();
  server.loadFixtures("users");

  expect(server.db.movies.length).toBe(0);
  expect([...server.db.users]).toEqual([{ id: "1", name: "Ada" }]);

  server.loadFixtures("movies");

  expect([...server.db.movies]).toEqual([{ id: "1", title: "Arrival" }]);

  server.db.emptyData();
  server.loadFixtures();

  expect(server.db.dump()).toEqual({
    movies: [{ id: "1", title: "Arrival" }],
    users: [{ id: "1", name: "Ada" }],
  });
});

test("preserves existing data and reports unknown fixture collections", () => {
  const server = createServer({
    fixtures: {
      movies: [{ title: "Arrival" }],
    },
    intercept: false,
  });

  server.db.movies.insert({ title: "Interstellar" });
  server.loadFixtures("movies");

  expect([...server.db.movies]).toEqual([
    { id: "1", title: "Arrival" },
    { id: "2", title: "Interstellar" },
    { id: "3", title: "Arrival" },
  ]);
  const untypedServer = server as unknown as {
    loadFixtures(...fixtureNames: string[]): void;
  };
  expect(() => untypedServer.loadFixtures("missing")).toThrow(
    'No fixture collection named "missing" is configured.',
  );
});
