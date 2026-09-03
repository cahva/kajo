import { beforeEach, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  association,
  belongsTo,
  createServer,
  Factory,
  hasMany,
  model,
  type ModelFor,
  type Server,
  trait,
} from "../src/index.ts";

interface User {
  name: string;
  role: "admin" | "member";
  slug: string;
}

const hooks: string[] = [];

const userFactory = Factory.extend<User>({
  name(sequence) {
    return `User ${sequence}`;
  },
  role: "member",
  slug() {
    return this.name.toLowerCase().replaceAll(" ", "-");
  },
  afterCreate(user) {
    hooks.push(`base:${user.id}`);
  },
  admin: trait<User>({
    afterCreate(user) {
      hooks.push(`admin:${user.id}`);
    },
    role: "admin",
  }),
});

function createUserServer() {
  return createServer({
    factories: {
      user: userFactory,
    },
    intercept: false,
    models: {
      user: model<User>(),
    },
  });
}

describe("factories", () => {
  beforeEach(() => {
    hooks.length = 0;
  });

  test("creates typed models with sequences and dependent attributes", () => {
    const server = createUserServer();

    const first = server.create("user");
    const second = server.create("user");

    expectTypeOf(first.name).toEqualTypeOf<string>();
    expect(first.attrs).toEqual({
      id: "1",
      name: "User 0",
      role: "member",
      slug: "user-0",
    });
    expect(second.attrs).toEqual({
      id: "2",
      name: "User 1",
      role: "member",
      slug: "user-1",
    });
  });

  test("resolves dependent attributes in any order and evaluates each once", () => {
    let nameCalls = 0;
    const factory = Factory.extend<{ label: string; name: string; slug: string }>({
      label() {
        return `${this.name} (${this.slug})`;
      },
      slug() {
        return this.name.toLowerCase().replaceAll(" ", "-");
      },
      name(sequence) {
        nameCalls += 1;
        return `User ${sequence}`;
      },
    });

    expect(factory.build(3).attributes).toEqual({
      label: "User 3 (user-3)",
      name: "User 3",
      slug: "user-3",
    });
    expect(nameCalls).toBe(1);
  });

  test("uses final trait values for dependent attributes", () => {
    const factory = Factory.extend<{ label: string; role: string }>({
      label() {
        return `Role: ${this.role}`;
      },
      role: "member",
      admin: trait({
        role: "admin",
      }),
    });

    expect(factory.build(0, ["admin"]).attributes).toEqual({
      label: "Role: admin",
      role: "admin",
    });
  });

  test("reports factory attribute dependency cycles", () => {
    const factory = Factory.extend<{ first: string; second: string }>({
      first() {
        return this.second;
      },
      second() {
        return this.first;
      },
    });

    expect(() => factory.build(0)).toThrow(
      "Factory attribute dependency cycle detected: first -> second -> first.",
    );
  });

  test("applies traits before final attribute overrides", () => {
    const server = createUserServer();

    const user = server.create("user", "admin", {
      name: "Ada Lovelace",
    });

    expect(user.attrs).toEqual({
      id: "1",
      name: "Ada Lovelace",
      role: "admin",
      slug: "ada-lovelace",
    });
    expect(hooks).toEqual(["base:1", "admin:1"]);
  });

  test("creates lists and keeps a sequence per server", () => {
    const server = createUserServer();
    const users = server.createList("user", 3);
    const otherServer = createUserServer();

    expect(users.map(({ name }) => name)).toEqual(["User 0", "User 1", "User 2"]);
    expect(otherServer.create("user").name).toBe("User 0");
  });

  test("builds typed models without persisting them or running creation hooks", () => {
    const server = createUserServer();
    const user = server.build("user", "admin", {
      name: "Ada Lovelace",
    });

    expectTypeOf(user.id).toEqualTypeOf<null>();
    expectTypeOf(user.name).toEqualTypeOf<string>();
    expect(user.attrs).toEqual({
      id: null,
      name: "Ada Lovelace",
      role: "admin",
      slug: "ada-lovelace",
    });
    expect(user.isNew()).toBe(true);
    expect(server.db.users.length).toBe(0);
    expect(hooks).toEqual([]);

    const saved = user.save();

    expect(saved.id).toBe("1");
    expect(server.db.users.length).toBe(1);
    expect(hooks).toEqual([]);
  });

  test("builds unpersisted lists and advances the shared factory sequence", () => {
    const server = createUserServer();
    const users = server.buildList("user", 2);

    expect(users.map(({ id }) => id)).toEqual([null, null]);
    expect(users.map(({ name }) => name)).toEqual(["User 0", "User 1"]);
    expect(server.db.users.length).toBe(0);
    expect(server.create("user").name).toBe("User 2");
    expect(() => server.buildList("user", -1)).toThrow(
      "Factory list count must be a non-negative integer.",
    );
  });

  test("persists declarative associations while leaving the built model unpersisted", () => {
    const server = createServer({
      factories: {
        post: Factory.extend<{ title: string }>({
          author: association(),
          title: "Factory builders",
        }),
        user: userFactory,
      },
      intercept: false,
      models: {
        post: model<{ title: string }>().extend({
          author: belongsTo("user"),
        }),
        user: model<User>().extend({
          posts: hasMany("post"),
        }),
      },
    });

    const post = server.build("post");

    expect(post.id).toBeNull();
    expect(post.author?.id).toBe("1");
    expect(server.db.posts.length).toBe(0);
    expect(server.db.users.length).toBe(1);
    expect(post.author?.posts.length).toBe(0);

    const saved = post.save();

    expect(saved.author?.posts.models.map(({ id }) => id)).toEqual([saved.id]);
  });

  test("reports invalid traits and list sizes", () => {
    const server = createUserServer();

    expect(() => server.create("user", "missing")).toThrow(
      'Factory does not define a "missing" trait.',
    );
    expect(server.create("user").name).toBe("User 0");
    expect(() => server.createList("user", -1)).toThrow(
      "Factory list count must be a non-negative integer.",
    );
  });

  test("runs hooks after relationships and overrides are persisted", () => {
    const observed: string[] = [];
    const server = createServer({
      factories: {
        user: Factory.extend<User>({
          afterCreate(user, server) {
            observed.push(`${user.name}:${server.schema.users.all().length}`);
          },
          name: "Grace",
          role: "member",
          slug: "grace",
        }),
      },
      intercept: false,
      models: {
        user: model<User>(),
      },
    });

    server.create("user");

    expect(observed).toEqual(["Grace:1"]);
  });

  test("can create typed relationship graphs from a hook", () => {
    const models = {
      post: model<{ title: string }>().extend({
        author: belongsTo("user"),
      }),
      user: model<User>().extend({
        posts: hasMany("post"),
      }),
    };
    type PostModel = ModelFor<typeof models, "post">;
    type TestServer = Server<{}, typeof models>;

    const server = createServer({
      factories: {
        post: Factory.extend<{ title: string }, PostModel, TestServer>({
          afterCreate(post, server) {
            post.author ??= server.create("user");
          },
          title: "Factory relationships",
        }),
        user: userFactory,
      },
      intercept: false,
      models,
    });

    const post = server.create("post");

    expect(post.author?.name).toBe("User 0");
    expect(post.author?.posts.models[0]?.id).toBe(post.id);
  });

  test("creates belongs-to relationships with factory associations", () => {
    const models = {
      post: model<{ title: string }>().extend({
        author: belongsTo("user"),
      }),
      user: model<User>().extend({
        posts: hasMany("post"),
      }),
    };
    const server = createServer({
      factories: {
        post: Factory.extend<{ title: string }>({
          author: association("admin"),
          title: "Factory associations",
        }),
        user: userFactory,
      },
      intercept: false,
      models,
    });

    const post = server.create("post");

    expect(post.author?.role).toBe("admin");
    expect(post.author?.posts.models.map(({ id }) => id)).toEqual([post.id]);
    expect(hooks).toEqual(["base:1", "admin:1"]);
  });

  test("prefers relationship overrides to factory associations", () => {
    const models = {
      post: model<{ title: string }>().extend({
        author: belongsTo("user"),
      }),
      user: model<User>(),
    };
    const server = createServer({
      factories: {
        post: Factory.extend<{ title: string }>({
          author: association(),
          title: "Overridden associations",
        }),
        user: userFactory,
      },
      intercept: false,
      models,
    });
    const author = server.create("user", { name: "Ada" });

    const post = server.create("post", { author });

    expect(post.author?.id).toBe(author.id);
    expect(server.schema.users.all().length).toBe(1);
  });

  test("reports invalid and cyclic factory associations", () => {
    const models = {
      post: model<{ title: string }>().extend({
        author: belongsTo("user"),
      }),
      user: model<User>().extend({
        post: belongsTo("post"),
      }),
    };

    expect(() =>
      createServer({
        factories: {
          post: Factory.extend<{ title: string }>({
            missing: association(),
            title: "Invalid",
          }),
        },
        intercept: false,
        models,
      }).create("post"),
    ).toThrow('Factory association "post.missing" does not match a model relationship.');

    const cyclic = createServer({
      factories: {
        post: Factory.extend<{ title: string }>({
          author: association(),
          title: "Cycle",
        }),
        user: Factory.extend<User>({
          name: "Ada",
          post: association(),
          role: "admin",
          slug: "ada",
        }),
      },
      intercept: false,
      models,
    });

    expect(() => cyclic.create("post")).toThrow(
      "Factory association cycle detected: post -> user -> post.",
    );
  });
});
