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
import { createServer } from "@cahva/kajo";

const server = createServer({
  fixtures: {
    movies: [{ title: "Arrival" }],
  },

  routes() {
    this.namespace = "api";

    this.get("/movies/:id", (schema, request) => schema.db.movies.find(request.params.id));
  },
});

const response = await fetch("/api/movies/1");
await response.json(); // { id: "1", title: "Arrival" }

server.shutdown();
```

Fixture types flow through `server.db` and the schema passed to route handlers.
Collections assign string IDs and support `find`, `findBy`, `where`, `insert`,
`firstOrCreate`, `update`, and `remove`. Use `loadData`, `emptyData`, and
`dump` to manage the database as a whole.

## Principles

- **TypeScript first.** Runtime definitions should be the source of static
  types rather than requiring duplicate declarations.
- **Compatibility focused.** Familiar Mirage JS concepts and behavior should
  make migration straightforward.
- **Portable.** Kajo should work across modern browsers and JavaScript
  runtimes.
- **Well tested.** Public behavior is specified by tests, including
  compatibility and regression coverage.

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
