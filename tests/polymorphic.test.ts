import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { belongsTo, createServer, hasMany, model, RestSerializer } from "../src/index.ts";

interface Comment {
  body: string;
}

interface Photo {
  url: string;
}

interface Post {
  title: string;
}

interface User {
  name: string;
}

function createCommentServer() {
  return createServer({
    intercept: false,
    models: {
      comment: model<Comment>().extend({
        commentable: belongsTo(["post", "photo"] as const, { inverse: "comments" }),
      }),
      photo: model<Photo>().extend({
        comments: hasMany("comment", { inverse: "commentable" }),
      }),
      post: model<Post>().extend({
        comments: hasMany("comment", { inverse: "commentable" }),
      }),
    },
  });
}

describe("polymorphic relationships", () => {
  test("stores typed identifiers and resolves each allowed model", () => {
    const server = createCommentServer();
    const post = server.schema.posts.create({ title: "Typed APIs" });
    const photo = server.schema.photos.create({ url: "/horizon.jpg" });
    const comment = server.schema.comments.create({
      body: "First",
      commentable: post,
    });

    expectTypeOf(comment.commentable).toEqualTypeOf<typeof post | typeof photo | null>();
    expectTypeOf(comment.commentableId).toEqualTypeOf<{
      readonly id: string;
      readonly type: "post" | "photo";
    } | null>();
    expect(comment.commentable?.id).toBe(post.id);
    expect(comment.commentable?.modelName).toBe("post");
    expect(comment.commentableId).toEqual({ id: post.id, type: "post" });
    expect(post.comments.models.map(({ id }) => id)).toEqual([comment.id]);

    comment.commentableId = { id: photo.id, type: "photo" };

    expect(comment.commentable?.id).toBe(photo.id);
    expect(comment.commentable?.modelName).toBe("photo");
    expect(photo.comments.models.map(({ id }) => id)).toEqual([comment.id]);
    expect(post.comments.length).toBe(0);
    expect(server.db.comments.find(comment.id)).toMatchObject({
      commentableId: { id: photo.id, type: "photo" },
    });
  });

  test("creates either target through polymorphic convenience helpers", () => {
    const server = createCommentServer();
    const comment = server.schema.comments.create({ body: "First" });

    const photo = comment.createCommentable("photo", { url: "/horizon.jpg" });
    expectTypeOf(photo.url).toEqualTypeOf<string>();
    expect(comment.commentable?.id).toBe(photo.id);
    expect(comment.commentable?.modelName).toBe("photo");

    const draft = comment.newCommentable("post", { title: "A draft" });
    expectTypeOf(draft.title).toEqualTypeOf<string>();
    expect(draft.id).toBeNull();
    expect(comment.commentable?.id).toBe(photo.id);
    expect(comment.commentable?.modelName).toBe("photo");
    expect(draft.save().comments.models.map(({ id }) => id)).toEqual([comment.id]);
  });

  test("cleans up only identifiers for the destroyed target type", () => {
    const server = createCommentServer();
    const post = server.schema.posts.create({ title: "Typed APIs" });
    const photo = server.schema.photos.create({ url: "/horizon.jpg" });
    const postComment = server.schema.comments.create({
      body: "Post",
      commentable: post,
    });
    const photoComment = server.schema.comments.create({
      body: "Photo",
      commentable: photo,
    });

    expect(post.id).toBe(photo.id);
    post.destroy();

    expect(postComment.commentable).toBeNull();
    expect(photoComment.commentable?.id).toBe(photo.id);
    expect(photoComment.commentable?.modelName).toBe("photo");
  });

  test("serializes polymorphic ids and sideloads by concrete model type", async () => {
    const server = createServer({
      intercept: false,
      models: {
        comment: model<Comment>().extend({
          commentable: belongsTo(["post", "photo"] as const),
        }),
        photo: model<Photo>(),
        post: model<Post>(),
      },
      routes() {
        this.get("/comments/:id", (schema, request) => schema.comments.find(request.params.id));
      },
      seeds(server) {
        const photo = server.schema.photos.create({ url: "/horizon.jpg" });
        server.schema.comments.create({ body: "First", commentable: photo });
      },
      serializers: {
        comment: RestSerializer.extend({ include: ["commentable"] }),
      },
    });

    const response = await server.handle(new Request("https://example.test/comments/1"));

    await expect(response?.json()).resolves.toEqual({
      comment: {
        body: "First",
        commentableId: { id: "1", type: "photo" },
        id: "1",
      },
      photos: [{ id: "1", url: "/horizon.jpg" }],
    });
  });

  test("rejects unknown targets in definitions, assignments, and ids", () => {
    expect(() =>
      createServer({
        intercept: false,
        models: {
          comment: model<Comment>().extend({
            commentable: belongsTo(["post", "missing"] as const),
          }),
          post: model<Post>(),
        },
      }),
    ).toThrow('Relationship "comment.commentable" targets unknown model "missing".');

    const server = createCommentServer();
    const comment = server.schema.comments.create({ body: "First" });
    const user = Reflect.get(
      createServer({
        intercept: false,
        models: { user: model<{ name: string }>() },
      }).schema,
      "users",
    ).create({ name: "Ada" });

    expect(() => Reflect.set(comment, "commentable", user)).toThrow(
      'The "commentable" relationship does not accept models of type "user".',
    );
    expect(() => Reflect.set(comment, "commentableId", { id: "1", type: "user" })).toThrow(
      'The "commentable" relationship does not accept models of type "user".',
    );
  });

  test("stores and resolves heterogeneous hasMany relationships", () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string }>(),
      },
    });
    const car = server.schema.cars.create({ make: "Volvo" });
    const watch = server.schema.watches.create({ make: "Leijona" });
    const user = server.schema.users.create({ name: "Ada", things: [watch, car] });

    expectTypeOf(user.things.models).toEqualTypeOf<(typeof car | typeof watch)[]>();
    expectTypeOf(user.thingIds).toEqualTypeOf<
      readonly { readonly id: string; readonly type: "car" | "watch" }[]
    >();
    expect(user.things.models.map(({ modelName }) => modelName)).toEqual(["watch", "car"]);
    expect(user.thingIds).toEqual([
      { id: watch.id, type: "watch" },
      { id: car.id, type: "car" },
    ]);

    user.thingIds = [{ id: watch.id, type: "watch" }];
    expect(user.things.models.map(({ modelName }) => modelName)).toEqual(["watch"]);

    watch.destroy();
    expect(user.thingIds).toEqual([]);
  });

  test("synchronizes polymorphic hasMany inverses and convenience helpers", () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>().extend({
          owner: belongsTo("user", { inverse: "things" }),
        }),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: "owner" }),
        }),
        watch: model<{ make: string }>().extend({
          owner: belongsTo("user", { inverse: "things" }),
        }),
      },
    });
    const user = server.schema.users.create({ name: "Ada" });
    const car = server.schema.cars.create({ make: "Volvo", owner: user });
    const watch = user.createThing("watch", { make: "Leijona" });

    expectTypeOf(watch.make).toEqualTypeOf<string>();
    expect(user.things.models.map(({ modelName }) => modelName)).toEqual(["car", "watch"]);
    expect(user.thingIds).toEqual([
      { id: car.id, type: "car" },
      { id: watch.id, type: "watch" },
    ]);

    user.things.remove(car).save();

    expect(car.owner).toBeNull();
    expect(watch.owner?.id).toBe(user.id);
    expect(user.thingIds).toEqual([{ id: watch.id, type: "watch" }]);
  });

  test("serializes polymorphic hasMany ids and concrete sideloads", async () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string }>(),
      },
      routes() {
        this.get("/users/:id", (schema, request) => schema.users.find(request.params.id));
      },
      serializers: {
        user: RestSerializer.extend({ include: ["things"] }),
      },
      seeds(server) {
        const car = server.schema.cars.create({ make: "Volvo" });
        const watch = server.schema.watches.create({ make: "Leijona" });
        server.schema.users.create({ name: "Ada", things: [car, watch] });
      },
    });

    const response = await server.handle(new Request("https://example.test/users/1"));

    await expect(response?.json()).resolves.toEqual({
      cars: [{ id: "1", make: "Volvo" }],
      user: {
        id: "1",
        name: "Ada",
        thingIds: [
          { id: "1", type: "car" },
          { id: "1", type: "watch" },
        ],
      },
      watches: [{ id: "1", make: "Leijona" }],
    });
  });
});
