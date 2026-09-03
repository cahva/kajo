# Kajo

> Your backend on the horizon.

Kajo is a fully typed, in-memory API simulator for building and testing
applications without a backend. It aims to provide the capabilities and
developer experience of [Mirage JS](https://miragejs.com/) with a modern
TypeScript-first design.

Kajo is Finnish for a faint glow or reflected light, often seen on the horizon:
something visible, but not quite tangible.

## Status

Kajo is in early development and does not have a stable public API yet.

The initial roadmap is:

- HTTP route handling, request interception, passthrough, and timing
- An in-memory database with typed models and relationships
- Factories, fixtures, traits, and seeds
- Serializers and route shorthand helpers
- A [compatibility suite](./COMPATIBILITY.md) covering Mirage JS behavior and
  relevant reported issues
- OpenAPI integration after the compatibility foundation is stable

## Current API

Kajo can register typed route handlers and intercept requests made with Fetch
or XMLHttpRequest:

```ts
import {
  belongsTo,
  createServer,
  Factory,
  hasMany,
  HttpError,
  model,
  association,
  RestSerializer,
  Serializer,
  trait,
} from "@cahva/kajo";

interface Movie {
  title: string;
}

const server = createServer({
  models: {
    movie: model<Movie>(),
  },

  routes() {
    this.namespace = "api";

    this.get("/movies/:id", (schema, request) => schema.movies.find(request.params.id));
  },

  seeds(server) {
    server.schema.movies.create({ title: "Arrival" });
  },
});

const response = await fetch("/api/movies/1");
await response.json(); // { movie: { id: "1", title: "Arrival" } }

server.shutdown();
```

Model and fixture types flow through `server.db` and the schema passed to route
handlers. Schema collections return model instances, while low-level database
collections support `find`, `findBy`, `where`, `insert`, `firstOrCreate`,
`update`, and `remove`. Use `loadData`, `emptyData`, and `dump` to manage the
database as a whole.

Configured fixtures load when the server is created and can be restored later,
either together or as a typed subset:

```ts
const server = createServer({
  fixtures: {
    movies: [{ title: "Arrival" }],
    users: [{ name: "Ada" }],
  },
});

server.db.emptyData();
server.loadFixtures("movies"); // "movies" | "users"
server.loadFixtures(); // load every configured fixture collection
```

`loadFixtures()` appends to existing collections. Call `db.emptyData()` first
when restoring a clean fixture state.

Use an application-wide or per-model identity manager when the simulated
backend uses UUIDs, slugs, or another ID format:

```ts
class TestIds {
  #ids = new Set<string>();
  #nextId = 1;

  fetch() {
    let id = `test-${this.#nextId++}`;

    while (this.#ids.has(id)) {
      id = `test-${this.#nextId++}`;
    }

    this.#ids.add(id);
    return id;
  }

  set(id: string | number) {
    const value = String(id);
    if (this.#ids.has(value)) throw new Error(`Duplicate id: ${value}`);
    this.#ids.add(value);
  }

  reset() {
    this.#ids.clear();
    this.#nextId = 1;
  }
}

createServer({
  identityManagers: {
    application: TestIds,
    // movie: MovieSpecificIds,
  },
  models: {
    movie: model<Movie>(),
  },
});
```

Kajo normalizes generated and supplied IDs to strings. Each collection gets
its own manager instance, and `db.emptyData()` resets that instance.

Schema collections also support unsaved models and common query helpers:

```ts
const draft = server.schema.movies.new({ title: "Contact" });
draft.isNew(); // true

const movie = draft.save();
movie.id; // string
movie.isSaved(); // true

server.schema.movies.findOrCreateBy({ title: "Arrival" });
server.schema.movies.none(); // an empty, typed Collection
```

Returned collections support typed, non-mutating `filter`, `slice`, and `sort`
helpers, plus bulk lifecycle operations:

```ts
const arrivals = server.schema.movies.all().filter((movie) => movie.title.startsWith("Arrival"));
arrivals.update({ title: "Arrival: Director's Cut" });
arrivals.reload();

// A hasMany collection persists membership changes when saved.
user.posts.add(post).remove(draft).save();
```

Relationships are declared by extending a typed model:

```ts
const models = {
  post: model<{ title: string }>().extend({
    author: belongsTo("user"),
  }),
  user: model<{ name: string }>().extend({
    posts: hasMany("post"),
  }),
};
```

Kajo infers the inverse when there is exactly one match. Use
`{ inverse: "relationshipName" }` to disambiguate, or `{ inverse: null }` for
an association without an inverse.

Relationship definitions add typed ID properties and creation helpers:

```ts
post.authorId = user.id;
user.postIds; // string[]

const draft = user.newPost({ title: "On the horizon" });
draft.save(); // associates the saved post with user

const post = user.createPost({ title: "A different light" });
```

Polymorphic belongs-to relationships use an explicit target tuple so their
values remain a typed union:

```ts
const models = {
  comment: model<{ body: string }>().extend({
    commentable: belongsTo(["post", "photo"] as const),
  }),
  photo: model<{ url: string }>(),
  post: model<{ title: string }>(),
  user: model<{ name: string }>().extend({
    things: hasMany(["post", "photo"] as const),
  }),
};

comment.commentable = post; // Post | Photo | null
comment.commentableId; // { type: "post" | "photo"; id: string } | null
comment.createCommentable("photo", { url: "/horizon.jpg" });

user.things; // PolymorphicCollection containing posts and photos
user.thingIds; // Array<{ type: "post" | "photo"; id: string }>
user.createThing("post", { title: "On the horizon" });
```

Polymorphic relationships use `PolymorphicCollection` for heterogeneous
to-many results. Their `{ type, id }` identifiers are preserved by
`RestSerializer`, and included resources are sideloaded under the root for
their concrete model. Polymorphic factory associations must be supplied as
explicit model overrides, because `association()` cannot infer which target to
create. Bulk `update()` only accepts attributes shared by every target model,
preventing target-specific fields from leaking onto unrelated records.

Destroying a model automatically clears foreign keys and stored ID references
from dependent models, preventing dangling relationships.

Models and collections pass through an application or model-specific
`Serializer`. Serializers control root keys, selected attributes, key
transforms, relationship IDs, sideloading, and embedding:

```ts
const PostSerializer = Serializer.extend({
  attrs: ["id", "title"],
  include: ["author"],
  embed: false,
});

createServer({
  models,
  serializers: {
    application: RestSerializer.extend({
      keyForAttribute: (attribute) => attribute,
    }),
    post: PostSerializer,
  },
});
```

`RestSerializer` uses rooted payloads and includes relationship IDs by default.
Rooted polymorphic collections group members under each concrete model's
collection root, including empty arrays when the collection has no members.
Rootless polymorphic collections return one flat array. All target serializers
must agree on rooted or rootless output; mixing the two modes throws an explicit
error instead of changing the response shape based on its contents.

Embedded polymorphic relationships include a collision-checked `__type`
discriminator. Its key passes through `keyForAttribute`, and
`keyForPolymorphicType` can customize it when another wire format is required.
For formats that need more than option callbacks, subclass `Serializer` or
`RestSerializer` and override `rootKey`, `serializeAttributes`,
`shouldSerializeRelationshipIds`, `serializeRelationshipIds`, or
`keyForPolymorphicType`. Calling `extend()` on a subclass preserves its class
and inherited behavior.

Routes can be defined at three levels. Use a custom handler when an endpoint
has application-specific behavior:

```ts
this.get("/posts/search", (schema, request) => {
  return schema.posts.where({ title: request.queryParams.title });
});

this.get("/files/*path", (_schema, request) => {
  return { path: request.params.path };
});

this.post("/posts/publish", (schema, request) => {
  const attributes = this.normalizedRequestAttrs(request, "post");
  return schema.posts.create({ ...attributes, published: true });
});
```

For conventional CRUD behavior, omit the handler. Kajo infers the schema
collection from the route and normalizes rooted JSON request bodies. Pass a
collection name when the URL and schema do not match:

```ts
this.get("/posts");
this.get("/posts/:id");
this.get("/articles", "posts");
this.get("/selected-posts", "posts", { coalesce: true });
this.post("/posts");
this.patch("/posts/:id");
this.del("/posts/:id");
```

`normalizedRequestAttrs()` accepts both `{ post: { ... } }` and unrooted
`{ ... }` JSON objects. The model name is checked against the configured model
registry and determines both the inferred attribute type and optional root.
Malformed or non-object JSON produces a structured `400` response.

Set `{ coalesce: true }` on a GET shorthand to retrieve selected records using
either common OpenAPI form-array encoding:

```text
GET /selected-posts?ids=1,3
GET /selected-posts?ids=1&ids=3
```

The response preserves requested ID order. A coalesced route without an `ids`
parameter behaves like its normal collection index.

Use `resource()` to register a complete CRUD resource:

```ts
this.resource("posts");
this.resource("users", { only: ["index", "show"] });
this.resource("blog-posts", {
  except: ["delete"],
  path: "/articles",
});
```

| Action   | Registered routes                    |
| -------- | ------------------------------------ |
| `index`  | `GET /posts`                         |
| `show`   | `GET /posts/:id`                     |
| `create` | `POST /posts`                        |
| `update` | `PUT /posts/:id`, `PATCH /posts/:id` |
| `delete` | `DELETE /posts/:id`                  |

`only` and `except` are mutually exclusive. A custom `path` changes the URL
without changing the schema collection.

Missing shorthand records return `404`, malformed shorthand payloads return
`400`, and custom handlers can throw `new HttpError(status, message)` for
expected JSON error responses.

### OpenAPI

Kajo can register example-backed routes directly from an OpenAPI 3.1 document.
Path templates are converted to Kajo parameters, JSON media types are preferred,
and the first named example is selected deterministically:

```ts
const server = createServer({
  openapi: {
    openapi: "3.1.0",
    info: { title: "Tasks", version: "1.0.0" },
    paths: {
      "/tasks/{taskId}": {
        get: {
          responses: {
            "200": {
              description: "A task",
              content: {
                "application/json": {
                  example: { id: "1", title: "On the horizon" },
                },
              },
            },
          },
        },
      },
    },
  },
  routes() {
    // Explicit routes are registered later and override generated operations.
    this.get("/tasks/:taskId", (_schema, request) => loadTask(request.params.taskId));
  },
});
```

Operations without examples generate a deterministic body from the response
JSON Schema. Each schema node uses `example`, `examples`, `const`, `default`,
or `enum` when present, merges `allOf`, picks the first `oneOf` or `anyOf`
branch, and otherwise synthesizes a placeholder from `type`: `"string"` or a
fixed constant for known string formats, the `minimum` or `0` for numbers,
`true` for booleans, one generated `items` element for arrays, and every
declared property for objects. Unconstrained schemas produce `{}`, and
recursive schemas require an explicit example.

The first increment supports inline examples, locally referenced examples, and
schema-generated values with concrete, `2XX`, or `default` success responses.
Local JSON Pointer references can target path items, responses, examples, and
schemas. External `$ref` resolution and request validation are planned next.

Kajo owns same-origin routes by default in browsers. Set `urlPrefix` for an
external API; requests outside that origin and namespace are ignored
automatically. Unhandled requests inside the boundary fail loudly unless they
match `passthrough()` or `unhandledRequest` is set to `"bypass"`:

```ts
createServer({
  urlPrefix: "https://api.example.test",
  routes() {
    this.namespace = "/v1";
    this.resource("posts");
    this.passthrough("/health", { methods: ["GET"] });
  },
});
```

Enable request diagnostics with `logging: true`. Handled requests are shown in
collapsed console groups with their status, matched route, duration, parsed
request body, raw request, and response. Passthrough, unhandled, and errored
requests are identified separately:

```ts
const server = createServer({
  logging: true,
  // ...
});

// Logging can also be toggled while debugging.
server.logging = false;
```

For test assertions or integration with another logging tool, pass a typed
callback instead:

```ts
createServer({
  logging(entry) {
    if (entry.type === "handled") {
      console.log(entry.method, entry.route, entry.response.status, entry.durationMs);
    }
  },
});
```

Enable `trackRequests` when tests need to inspect traffic after it has been
routed. Tracking is off by default to avoid retaining requests throughout long
development sessions:

```ts
const server = createServer({
  trackRequests: true,
  // ...
});

expect(server.handledRequests[0]?.requestBody).toBe('{"status":"done"}');

server.requestHistory;
server.passthroughRequests;
server.unhandledRequests;
server.erroredRequests;
server.clearRequestHistory();
```

Factories generate realistic model data with sequences, dependent attributes,
traits, and final overrides:

```ts
interface User {
  active: boolean;
  name: string;
  role: "admin" | "member";
  slug: string;
}

const userFactory = Factory.extend<User>({
  active: true,
  afterCreate(user) {
    console.log(`Created ${user.id}`);
  },
  slug() {
    return this.name.toLowerCase().replaceAll(" ", "-");
  },
  name: (sequence) => `User ${sequence}`,
  role: "member",
  admin: trait<User>({ role: "admin" }),
});

createServer({
  factories: { user: userFactory },
  models: { user: model<User>() },
  seeds(server) {
    server.createList("user", 5);
    server.create("user", "admin", { name: "Ada" });

    const draft = server.build("user", { name: "Linnea" });
    draft.id; // null
    draft.save(); // persist later

    server.buildList("user", 3); // three typed, unpersisted models
  },
});
```

Dependent attributes resolve lazily, so `slug` can read `name` even though it is
declared first. Each function runs once per build. Dependency cycles report the
attribute chain that caused them.

`build()` and `buildList()` consume the same per-server sequence as `create()`
and apply traits, overrides, dependencies, and declarative associations. The
primary models remain unpersisted and creation hooks do not run. Declarative
associations are persisted so a built model can safely reference and later save
them.

Use `association()` on a belongs-to relationship to create its related model.
Trait names are forwarded to the associated factory, while an explicit
relationship passed to `server.create()` takes precedence:

```ts
const postFactory = Factory.extend<{ title: string }>({
  author: association("admin"),
  title: "A typed factory graph",
});

const post = server.create("post");
const postByAda = server.create("post", { author: ada });
```

## Principles

- **TypeScript first.** Runtime definitions should be the source of static
  types rather than requiring duplicate declarations.
- **Compatibility focused.** Familiar Mirage JS concepts and behavior should
  make migration straightforward.
- **Portable.** Kajo should work across modern browsers and JavaScript
  runtimes.
- **Well tested.** Public behavior is specified by tests, including
  compatibility and regression coverage.

See the living [Mirage JS compatibility matrix](./COMPATIBILITY.md) for
supported behavior, intentional differences, and the prioritized parity
backlog.

## Examples

Runnable examples live in [`examples`](./examples). The vanilla TypeScript task
board exercises Kajo through real browser requests:

```bash
vp install
vp run example:task-board
```

## Development

Install dependencies:

```bash
vp install
```

Run formatting, linting, and type checks:

```bash
vp check
```

Run the unit tests:

```bash
vp test
```

Run the real-browser interception suite:

```bash
vp install
vp exec playwright install chromium
vp run test:browser
```

Set `KAJO_CHROMIUM_PATH` to use an existing Chromium executable instead of a
Playwright-managed browser. After dependencies and a browser are installed,
subsequent runs only need `vp run test:browser`.

Build the library:

```bash
vp run build
```

Validate the package with JSR without publishing it:

```bash
vp run publish:check
```

## Publishing

Kajo will be published to JSR as [`@cahva/kajo`](https://jsr.io/@cahva/kajo).
The registry receives the TypeScript source declared in `jsr.json`; the local
library build remains available for development and verification.

## License

[MIT](./LICENSE)

## Acknowledgements

Kajo is inspired by [Mirage JS](https://github.com/miragejs/miragejs), which is
also licensed under the MIT License. Kajo is an independent project and is not
affiliated with Mirage JS or its maintainers.
