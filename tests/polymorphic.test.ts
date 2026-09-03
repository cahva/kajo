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

  test("does not let relationship options clobber polymorphic metadata", () => {
    const unsafeOptions = {
      inverse: null,
      kind: "invalid",
      modelNames: ["missing"],
      polymorphic: false,
    } as never;
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>(),
        comment: model<Comment>().extend({
          commentable: belongsTo(["car", "watch"] as const, unsafeOptions),
        }),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, unsafeOptions),
        }),
        watch: model<{ make: string }>(),
      },
    });

    expect(server.schema.users.create({ name: "Ada" }).things.modelNames).toEqual(["car", "watch"]);
    expect(server.schema.comments.create({ body: "Safe" }).commentable).toBeNull();
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

  test("reports malformed fixture identifiers using the hasMany key", () => {
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
    server.db.users.insert({ name: "Ada", thingIds: ["1"] } as never);

    expect(() => server.schema.users.find(1)?.things).toThrow(
      'The "thingIds" relationship id property expects an object with "type" and "id"; received "1".',
    );
  });

  test("normalizes numeric polymorphic ids while reading and destroying models", () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>(),
        comment: model<Comment>().extend({
          commentable: belongsTo(["car", "watch"] as const, { inverse: null }),
        }),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string }>(),
      },
    });
    server.db.cars.insert({ make: "Volvo" });
    server.db.comments.insert({
      body: "Nice",
      commentableId: { id: 1, type: "car" },
    } as never);
    server.db.users.insert({
      name: "Ada",
      thingIds: [{ id: 1, type: "car" }],
    } as never);

    const car = server.schema.cars.find(1);
    expect(server.schema.users.find(1)?.things.models[0]?.id).toBe(car?.id);
    expect(server.schema.comments.find(1)?.commentable?.id).toBe(car?.id);

    car?.destroy();

    expect(server.db.users.find(1)).toMatchObject({ thingIds: [] });
    expect(server.db.comments.find(1)).not.toHaveProperty("commentableId");
  });

  test("normalizes numeric ids while deriving a polymorphic belongsTo inverse", () => {
    const server = createServer({
      intercept: false,
      models: {
        comment: model<Comment>().extend({
          commentable: belongsTo(["user"] as const, { inverse: "comments" }),
        }),
        user: model<User>().extend({
          comments: hasMany("comment", { inverse: "commentable" }),
        }),
      },
    });
    server.db.users.insert({ name: "Ada" });
    server.db.comments.insert({
      body: "Hi",
      commentableId: { id: 1, type: "user" },
    } as never);

    expect(server.schema.users.find(1)?.comments.models.map(({ id }) => id)).toEqual(["1"]);
  });

  test("clears the previous polymorphic belongsTo inverse during reassignment", () => {
    const server = createServer({
      intercept: false,
      models: {
        photo: model<Photo>().extend({
          owner: belongsTo(["user"] as const, { inverse: "avatar" }),
        }),
        user: model<User>().extend({
          avatar: belongsTo(["photo", "video"] as const, { inverse: "owner" }),
        }),
        video: model<{ url: string }>().extend({
          owner: belongsTo(["user"] as const, { inverse: "avatar" }),
        }),
      },
    });
    const ada = server.schema.users.create({ name: "Ada" });
    const linus = server.schema.users.create({ name: "Linus" });
    const photo = server.schema.photos.create({ url: "/avatar.jpg" });

    photo.owner = ada;
    photo.owner = linus;

    expect(ada.avatar).toBeNull();
    expect(linus.avatar?.id).toBe(photo.id);
    expect(server.db.users.find(ada.id)).not.toHaveProperty("avatarId");
  });

  test("updates attributes shared by every polymorphic member", () => {
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
    const user = server.schema.users.create({ name: "Ada", things: [car, watch] });

    user.things.update("make", "Kajo");

    expect(car.make).toBe("Kajo");
    expect(watch.make).toBe("Kajo");
    const assertUpdateTypes = () => {
      // @ts-expect-error Model ids cannot be updated.
      user.things.update("id", "9");
    };
    void assertUpdateTypes;
  });

  test("rejects conflicting shared attribute types in bulk updates", () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ year: number }>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ year: string }>(),
      },
    });
    const things = server.schema.users.create({ name: "Ada" }).things;

    const assertUpdateTypes = () => {
      // @ts-expect-error Conflicting target attribute types have no safe update value.
      things.update("year", 2020);
      // @ts-expect-error Conflicting target attribute types have no safe update value.
      things.update("year", "2020");
    };
    void assertUpdateTypes;
  });

  test("rejects merging polymorphic collections with different target sets", () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>(),
        bucket: model<{ name: string }>().extend({
          items: hasMany(["car", "post"] as const, { inverse: null }),
        }),
        post: model<Post>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string }>(),
      },
    });
    const things = server.schema.users.create({ name: "Ada" }).things;
    const items = server.schema.buckets.create({ name: "Favorites" }).items;

    expect(() => things.mergeCollection(items as never)).toThrow(
      "Cannot merge a polymorphic collection accepting car, post into one accepting car, watch.",
    );
  });

  test("rejects invalid polymorphic members when constructing an unsaved model", () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>(),
        post: model<Post>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string }>(),
      },
    });
    const post = server.schema.posts.create({ title: "Wrong type" });

    expect(() => server.schema.users.new({ name: "Ada", things: [post] as never })).toThrow(
      'The "things" relationship does not accept models of type "post".',
    );
  });

  test("serializes polymorphic collections returned directly from handlers", async () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ internal: string; make: string }>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ internal: string; make: string }>(),
      },
      routes() {
        this.get(
          "/users/:id/things",
          (schema, request) => schema.users.find(request.params.id)?.things,
        );
      },
      seeds(server) {
        const car = server.schema.cars.create({ internal: "hidden", make: "Volvo" });
        const watch = server.schema.watches.create({ internal: "hidden", make: "Leijona" });
        server.schema.users.create({ name: "Ada", things: [car, watch] });
      },
      serializers: {
        application: RestSerializer.extend({
          attrs: ["id", "make"],
          keyForAttribute: (attribute) => attribute.toUpperCase(),
          keyForCollection: (modelName) => `all_${modelName}`,
        }),
      },
    });

    const response = await server.handle(new Request("https://example.test/users/1/things"));

    await expect(response?.json()).resolves.toEqual({
      all_car: [{ ID: "1", MAKE: "Volvo" }],
      all_watch: [{ ID: "1", MAKE: "Leijona" }],
    });
  });

  test("keeps empty polymorphic collection response roots", async () => {
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
        this.get("/things", (schema) => schema.users.find(1)?.things);
      },
      seeds(server) {
        server.schema.users.create({ name: "Ada" });
      },
    });

    const response = await server.handle(new Request("https://example.test/things"));

    await expect(response?.json()).resolves.toEqual({
      cars: [],
      watches: [],
    });
  });

  test("does not duplicate a primary polymorphic member that is also sideloaded", async () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string }>().extend({
          car: belongsTo("car", { inverse: null }),
        }),
      },
      routes() {
        this.get("/things", (schema) => schema.users.find(1)?.things);
      },
      seeds(server) {
        const car = server.schema.cars.create({ make: "Volvo" });
        const watch = server.schema.watches.create({ car, make: "Leijona" });
        server.schema.users.create({ name: "Ada", things: [car, watch] });
      },
      serializers: {
        watch: RestSerializer.extend({ include: ["car"] }),
      },
    });

    const response = await server.handle(new Request("https://example.test/things"));

    await expect(response?.json()).resolves.toEqual({
      cars: [{ id: "1", make: "Volvo" }],
      watches: [{ carId: "1", id: "1", make: "Leijona" }],
    });
  });

  test("emits transitive sideloads from polymorphic collections", async () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string }>().extend({
          owner: belongsTo("user", { inverse: null }),
        }),
        user: model<User>().extend({
          manager: belongsTo("user", { inverse: null }),
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string }>(),
      },
      routes() {
        this.get("/things", (schema) => schema.users.findBy({ name: "Collector" })?.things);
      },
      seeds(server) {
        const manager = server.schema.users.create({ name: "Linus" });
        const owner = server.schema.users.create({ manager, name: "Ada" });
        const car = server.schema.cars.create({ make: "Volvo", owner });
        server.schema.users.create({ name: "Collector", things: [car] });
      },
      serializers: {
        car: RestSerializer.extend({ include: ["owner"] }),
        user: RestSerializer.extend({ include: ["manager"] }),
      },
    });

    const response = await server.handle(new Request("https://example.test/things"));

    await expect(response?.json()).resolves.toEqual({
      cars: [{ id: "1", make: "Volvo", ownerId: "2" }],
      users: [
        { id: "2", managerId: "1", name: "Ada", thingIds: [] },
        { id: "1", managerId: null, name: "Linus", thingIds: [] },
      ],
      watches: [],
    });
  });

  test("rejects mixed rooted and rootless polymorphic serializers", async () => {
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
        this.get("/things", (schema) => schema.users.find(1)?.things);
      },
      seeds(server) {
        const car = server.schema.cars.create({ make: "Volvo" });
        const watch = server.schema.watches.create({ make: "Leijona" });
        server.schema.users.create({ name: "Ada", things: [car, watch] });
      },
      serializers: {
        car: RestSerializer.extend({ root: false }),
        watch: RestSerializer.extend(),
      },
    });

    await expect(server.handle(new Request("https://example.test/things"))).rejects.toThrow(
      "A polymorphic collection cannot mix rooted and rootless target serializers.",
    );
  });

  test("embeds type discriminators for polymorphic hasMany members", async () => {
    const server = createServer({
      intercept: false,
      models: {
        car: model<{ make: string; type: string }>(),
        user: model<User>().extend({
          things: hasMany(["car", "watch"] as const, { inverse: null }),
        }),
        watch: model<{ make: string; type: string }>(),
      },
      routes() {
        this.get("/users/:id", (schema, request) => schema.users.find(request.params.id));
      },
      seeds(server) {
        const car = server.schema.cars.create({ make: "Volvo", type: "sedan" });
        const watch = server.schema.watches.create({ make: "Leijona", type: "wristwatch" });
        server.schema.users.create({ name: "Ada", things: [car, watch] });
      },
      serializers: {
        application: RestSerializer.extend({
          keyForAttribute: (attribute) => attribute.toUpperCase(),
        }),
        user: RestSerializer.extend({
          embed: true,
          include: ["things"],
          keyForAttribute: (attribute) => attribute.toUpperCase(),
        }),
      },
    });

    const response = await server.handle(new Request("https://example.test/users/1"));

    await expect(response?.json()).resolves.toEqual({
      user: {
        ID: "1",
        NAME: "Ada",
        things: [
          { __TYPE: "car", ID: "1", MAKE: "Volvo", TYPE: "sedan" },
          { __TYPE: "watch", ID: "1", MAKE: "Leijona", TYPE: "wristwatch" },
        ],
      },
    });
  });

  test("embeds a transformed discriminator for polymorphic belongsTo", async () => {
    const server = createServer({
      intercept: false,
      models: {
        comment: model<Comment>().extend({
          commentable: belongsTo(["photo", "post"] as const, { inverse: null }),
        }),
        photo: model<Photo>(),
        post: model<Post>(),
      },
      routes() {
        this.get("/comments/:id", (schema, request) => schema.comments.find(request.params.id));
      },
      seeds(server) {
        const photo = server.schema.photos.create({ url: "/horizon.jpg" });
        server.schema.comments.create({ body: "Nice", commentable: photo });
      },
      serializers: {
        application: RestSerializer.extend({
          keyForAttribute: (attribute) => attribute.toUpperCase(),
        }),
        comment: RestSerializer.extend({
          embed: true,
          include: ["commentable"],
          keyForAttribute: (attribute) => attribute.toUpperCase(),
        }),
      },
    });

    const response = await server.handle(new Request("https://example.test/comments/1"));

    await expect(response?.json()).resolves.toEqual({
      comment: {
        BODY: "Nice",
        commentable: {
          __TYPE: "photo",
          ID: "1",
          URL: "/horizon.jpg",
        },
        ID: "1",
      },
    });
  });
});
