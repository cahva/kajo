import { describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  createServer,
  model,
  RestSerializer,
  type SerializableModel,
  Serializer,
  type RelationshipRegistry,
} from "../src/index.ts";

function createPostServer(serializer: Serializer) {
  return createServer({
    fixtures: {
      posts: [{ authorId: "1", title: "Typed APIs" }],
      users: [{ name: "Ada" }],
    },
    intercept: false,
    models: {
      post: model<{ title: string }>().extend({
        author: belongsTo("user"),
      }),
      user: model<{ name: string }>(),
    },
    routes() {
      this.get("/posts/:id", (schema, request) => schema.posts.find(request.params.id));
    },
    serializers: {
      post: serializer,
    },
  });
}

describe("serializers", () => {
  test("uses model and collection roots by default", async () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<{ title: string }>(),
      },
      routes() {
        this.get("/posts", (schema) => schema.posts.all());
      },
      seeds(server) {
        server.schema.posts.create({ title: "Typed APIs" });
      },
    });

    const response = await server.handle(new Request("https://example.test/posts"));

    await expect(response?.json()).resolves.toEqual({
      posts: [{ id: "1", title: "Typed APIs" }],
    });
  });

  test("supports attribute selection, key transforms, and disabled roots", async () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<{ internal: boolean; title: string }>(),
      },
      routes() {
        this.get("/posts/:id", (schema, request) => schema.posts.find(request.params.id));
      },
      seeds(server) {
        server.schema.posts.create({
          internal: true,
          title: "Typed APIs",
        });
      },
      serializers: {
        application: Serializer.extend({
          attrs: ["title"],
          keyForAttribute: (attribute) => attribute.toUpperCase(),
          root: false,
        }),
      },
    });

    const response = await server.handle(new Request("https://example.test/posts/1"));

    await expect(response?.json()).resolves.toEqual({
      TITLE: "Typed APIs",
    });
  });

  test("prefers a model serializer over the application serializer", async () => {
    const applicationSerializer = Serializer.extend({
      root: false,
    });
    const server = createServer({
      intercept: false,
      models: {
        post: model<{ title: string }>(),
      },
      routes() {
        this.get("/posts/:id", (schema, request) => schema.posts.find(request.params.id));
      },
      seeds(server) {
        server.schema.posts.create({ title: "Typed APIs" });
      },
      serializers: {
        application: applicationSerializer,
        post: applicationSerializer.extend({ root: true }),
      },
    });

    const response = await server.handle(new Request("https://example.test/posts/1"));

    await expect(response?.json()).resolves.toEqual({
      post: { id: "1", title: "Typed APIs" },
    });
  });

  test("sideloads included relationships and serializes their ids", async () => {
    const server = createPostServer(Serializer.extend({ include: ["author"] }));
    const response = await server.handle(new Request("https://example.test/posts/1"));

    await expect(response?.json()).resolves.toEqual({
      post: {
        authorId: "1",
        id: "1",
        title: "Typed APIs",
      },
      users: [{ id: "1", name: "Ada" }],
    });
  });

  test("emits transitive sideloads from homogeneous resources", async () => {
    const server = createServer({
      intercept: false,
      models: {
        post: model<{ title: string }>().extend({
          author: belongsTo("user", { inverse: null }),
        }),
        user: model<{ name: string }>().extend({
          manager: belongsTo("user", { inverse: null }),
        }),
      },
      routes() {
        this.get("/posts/:id", (schema, request) => schema.posts.find(request.params.id));
      },
      seeds(server) {
        const manager = server.schema.users.create({ name: "Linus" });
        const author = server.schema.users.create({ manager, name: "Ada" });
        server.schema.posts.create({ author, title: "Typed APIs" });
      },
      serializers: {
        post: RestSerializer.extend({ include: ["author"] }),
        user: RestSerializer.extend({ include: ["manager"] }),
      },
    });
    const response = await server.handle(new Request("https://example.test/posts/1"));

    await expect(response?.json()).resolves.toEqual({
      post: {
        authorId: "2",
        id: "1",
        title: "Typed APIs",
      },
      users: [
        { id: "2", managerId: "1", name: "Ada" },
        { id: "1", managerId: null, name: "Linus" },
      ],
    });
  });

  test("embeds included relationships", async () => {
    const server = createPostServer(
      Serializer.extend({
        embed: true,
        include: ["author"],
      }),
    );
    const response = await server.handle(new Request("https://example.test/posts/1"));

    await expect(response?.json()).resolves.toEqual({
      post: {
        author: { id: "1", name: "Ada" },
        id: "1",
        title: "Typed APIs",
      },
    });
  });

  test("supports request-dependent includes and serializeIds", async () => {
    const server = createPostServer(
      Serializer.extend({
        include: (request) => (request.queryParams.include === "author" ? ["author"] : []),
        serializeIds: "always",
      }),
    );
    const response = await server.handle(new Request("https://example.test/posts/1"));

    await expect(response?.json()).resolves.toEqual({
      post: {
        authorId: "1",
        id: "1",
        title: "Typed APIs",
      },
    });
  });

  test("RestSerializer includes relationship ids without sideloading", async () => {
    const serializer = RestSerializer.extend();
    const server = createPostServer(serializer);
    const response = await server.handle(new Request("https://example.test/posts/1"));

    expect(serializer).toBeInstanceOf(RestSerializer);
    await expect(response?.json()).resolves.toEqual({
      post: {
        authorId: "1",
        id: "1",
        title: "Typed APIs",
      },
    });
  });

  test("supports class-based attribute and root extensions", async () => {
    class ApiSerializer extends RestSerializer {
      override rootKey(modelName: string, isCollection: boolean): string {
        return `${super.rootKey(modelName, isCollection)}Payload`;
      }

      override serializeAttributes(
        resource: SerializableModel,
        relationships: RelationshipRegistry,
      ): Record<string, unknown> {
        return {
          ...super.serializeAttributes(resource, relationships),
          resourceType: resource.modelName,
        };
      }
    }

    const server = createPostServer(ApiSerializer.extend());
    const response = await server.handle(new Request("https://example.test/posts/1"));

    await expect(response?.json()).resolves.toEqual({
      postPayload: {
        authorId: "1",
        id: "1",
        resourceType: "post",
        title: "Typed APIs",
      },
    });
  });
});
