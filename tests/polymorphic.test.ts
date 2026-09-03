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
});
