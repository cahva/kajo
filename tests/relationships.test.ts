import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, createServer, hasMany, model } from "../src/index.ts";

interface Post {
  title: string;
}

interface User {
  name: string;
}

describe("relationships", () => {
  test("resolves belongsTo and inferred hasMany inverses", () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<Post>().extend({
          author: belongsTo("user"),
        }),
        user: model<User>().extend({
          posts: hasMany("post"),
        }),
      },
    });
    const user = server.schema.users.create({ name: "Ada" });
    const post = server.schema.posts.create({
      author: user,
      title: "Typed APIs",
    });

    expectTypeOf(post.author?.name).toEqualTypeOf<string | undefined>();
    expect(post.author?.id).toBe(user.id);
    expect(user.posts.models[0]?.id).toBe(post.id);
    expect(server.db.posts.find(post.id)).toEqual({
      authorId: user.id,
      id: post.id,
      title: "Typed APIs",
    });

    post.author = null;

    expect(post.author).toBeNull();
    expect(user.posts.length).toBe(0);
  });

  test("defers unsaved relationship synchronization until save", () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<Post>().extend({
          author: belongsTo("user"),
        }),
        user: model<User>().extend({
          posts: hasMany("post"),
        }),
      },
    });
    const user = server.schema.users.create({ name: "Ada" });
    const post = server.schema.posts.new({
      author: user,
      title: "Typed APIs",
    });

    expect(post.author).toBe(user);
    expect(user.posts.length).toBe(0);

    const saved = post.save();

    expect(saved.author?.id).toBe(user.id);
    expect(user.posts.models[0]?.id).toBe(saved.id);
    expect(server.db.posts.find(saved.id)).toMatchObject({ authorId: user.id });
  });

  test("synchronizes assignment through a hasMany inverse", () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<Post>().extend({
          author: belongsTo("user"),
        }),
        user: model<User>().extend({
          posts: hasMany("post"),
        }),
      },
    });
    const post = server.schema.posts.create({
      title: "On the horizon",
    });
    const user = server.schema.users.create({ name: "Linnea" });

    user.posts = server.schema.posts.find([post.id]);

    expect(post.author?.id).toBe(user.id);
    expect(server.db.posts.find(post.id)).toEqual({
      authorId: user.id,
      id: post.id,
      title: "On the horizon",
    });

    user.posts = server.schema.posts.find([]);

    expect(post.author).toBeNull();
  });

  test("uses explicit inverses when models have multiple relationships", () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<Post>().extend({
          author: belongsTo("user", {
            inverse: "authoredPosts",
          }),
          reviewer: belongsTo("user", {
            inverse: "reviewedPosts",
          }),
        }),
        user: model<User>().extend({
          authoredPosts: hasMany("post", { inverse: "author" }),
          reviewedPosts: hasMany("post", {
            inverse: "reviewer",
          }),
        }),
      },
    });
    const author = server.schema.users.create({ name: "Ada" });
    const reviewer = server.schema.users.create({
      name: "Linnea",
    });
    const post = server.schema.posts.create({
      author,
      reviewer,
      title: "A different light",
    });

    expect(author.authoredPosts.models[0]?.id).toBe(post.id);
    expect(author.reviewedPosts.length).toBe(0);
    expect(reviewer.reviewedPosts.models[0]?.id).toBe(post.id);
  });

  test("stores hasMany ids when a relationship has no inverse", () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<Post>().extend({
          tags: hasMany("tag", { inverse: null }),
        }),
        tag: model<{ name: string }>(),
      },
    });
    const typescript = server.schema.tags.create({
      name: "TypeScript",
    });
    const testing = server.schema.tags.create({ name: "Testing" });
    const post = server.schema.posts.create({
      tags: [typescript, testing],
      title: "Reliable mocks",
    });

    expect(post.tags.models.map(({ name }) => name)).toEqual(["TypeScript", "Testing"]);
    expect(server.db.posts.find(post.id)).toEqual({
      id: post.id,
      tagIds: [typescript.id, testing.id],
      title: "Reliable mocks",
    });
  });

  test("synchronizes one-to-one relationships", () => {
    const server = createServer({
      intercept: false,
      models: {
        profile: model<{ bio: string }>().extend({
          user: belongsTo("user", { inverse: "profile" }),
        }),
        user: model<User>().extend({
          profile: belongsTo("profile", { inverse: "user" }),
        }),
      },
    });
    const user = server.schema.users.create({ name: "Ada" });
    const profile = server.schema.profiles.create({
      bio: "API designer",
      user,
    });

    expect(user.profile?.id).toBe(profile.id);
    expect(profile.user?.id).toBe(user.id);

    profile.user = null;

    expect(user.profile).toBeNull();
  });

  test("synchronizes many-to-many relationships", () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<Post>().extend({
          tags: hasMany("tag", { inverse: "posts" }),
        }),
        tag: model<{ name: string }>().extend({
          posts: hasMany("post", { inverse: "tags" }),
        }),
      },
    });
    const tag = server.schema.tags.create({ name: "TypeScript" });
    const post = server.schema.posts.create({
      tags: [tag],
      title: "Typed relationships",
    });

    expect(tag.posts.models[0]?.id).toBe(post.id);

    post.tags = server.schema.tags.find([]);

    expect(tag.posts.length).toBe(0);
  });

  test("rejects invalid relationship configuration", () => {
    expect(() =>
      createServer({
        intercept: false,
        models: {
          post: model<Post>().extend({
            author: belongsTo("missing"),
          }),
        },
      }),
    ).toThrow('Relationship "post.author" targets unknown model "missing".');
  });
});
