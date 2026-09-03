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
- A compatibility suite covering Mirage JS behavior and relevant reported
  issues
- OpenAPI integration after the compatibility foundation is stable

## Current API

Kajo can register typed route handlers and intercept requests made with Fetch
or XMLHttpRequest:

```ts
import { belongsTo, createServer, Factory, hasMany, model, Serializer, trait } from "@cahva/kajo";

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
    post: PostSerializer,
  },
});
```

Conventional CRUD routes can omit their handlers. Kajo infers the schema
collection from the route and normalizes rooted JSON request bodies:

```ts
createServer({
  models,
  routes() {
    this.get("/posts");
    this.get("/posts/:id");
    this.post("/posts");
    this.patch("/posts/:id");
    this.del("/posts/:id");
  },
});
```

Factories generate realistic model data with sequences, dependent attributes,
traits, and final overrides:

```ts
interface User {
  active: boolean;
  name: string;
  role: "admin" | "member";
}

const userFactory = Factory.extend<User>({
  active: true,
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
  },
});
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
