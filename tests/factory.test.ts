import { beforeEach, describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
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
});
