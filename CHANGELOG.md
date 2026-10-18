# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- WebSocket routes. `this.websocket(path, handler)` intercepts matching
  `WebSocket` connections and hands the client to `handler`, along with path
  params, the schema, and the real server connection for passthrough. It
  returns a handle whose `broadcast(data)` pushes to every open client on the
  route. Unmatched connections reach the network, a handler that throws or
  rejects closes its client with code `1011`, and `shutdown()` closes mocked
  clients.

## [0.1.5] - 2026-10-17

### Fixed

- The Document Navigation list on the main JSR docs page, which went empty in
  0.1.4 when the module overview gained section headings.

## [0.1.4] - 2026-10-17

### Added

- An overview with examples on the main entry point's JSR docs page.

### Fixed

- The README and module overview quick starts now run in Node.js, which needs a
  `urlPrefix` and absolute request URLs.
- The README no longer lists imported JSON Schema validation as future work.

## [0.1.3] - 2026-10-17

### Changed

- The README opens with the Kajo banner, on GitHub and on the JSR package
  page.

## [0.1.2] - 2026-10-17

### Fixed

- The README's examples link, which pointed at a folder JSR does not
  publish.

## [0.1.1] - 2026-10-17

### Added

- Documentation for every exported symbol, so the JSR docs cover the whole
  API.
- A `StandardTypedV1` type re-export, the base of the re-exported Standard
  Schema types.

### Changed

- A package description that says what Kajo does.

## [0.1.0] - 2026-10-17

First public release.

### Added

- A typed `createServer` API with dynamic, wildcard, and namespaced routes,
  static JSON, native `Response`, and async handlers, plus global and per-route
  response timing.
- Automatic Fetch and XMLHttpRequest interception with origin-aware request
  ownership, `urlPrefix` support, method-aware `passthrough()` rules, and
  strict unhandled-request diagnostics.
- Typed in-memory collections with fixtures, seeds, `loadFixtures()`, queries,
  mutations, reset, and application-wide or per-model identity managers.
- Typed models with an unsaved lifecycle (`new`, `save`, `update`), schema
  collection helpers, and collection filtering, sorting, and bulk operations.
- Schema-backed models through the Standard JSON Schema interface, working with
  Zod, Valibot, and ArkType.
- `belongsTo` and `hasMany` relationships, including polymorphic ones, with
  inverse discovery, foreign-key synchronization, association helpers, and
  cleanup when a model is destroyed.
- Application and per-model serializers with roots, attribute filtering, key
  transforms, relationship IDs, sideloading, embedding, and a `RestSerializer`
  preset.
- CRUD route shorthands, coalesced GET shorthands, the `resource()` helper, and
  `normalizedRequestAttrs()` for custom handlers.
- Typed factories with sequences, dependent attributes, traits, `afterCreate`
  hooks, belongs-to associations, and `build()`/`buildList()` helpers.
- Structured JSON responses for `HttpError` failures.
- Typed request diagnostics with an optional collapsed browser-console view,
  and opt-in request history.
- OpenAPI 3.1 import: example-backed operations, local `$ref` resolution,
  deterministic schema-generated responses, and `operationId` handlers backed
  by seeded data.
- OpenAPI contracts on Kajo-defined routes with Standard Schema request
  validation, structured `400` responses, and combined document export.
- A pluggable JSON Schema validator for imported OpenAPI parameters and request
  bodies, and an optional `@cahva/kajo/openapi/ajv` adapter using Ajv with JSON
  Schema 2020-12 and common formats.
- Task-board and OpenAPI-first Petstore browser examples, and a Mirage JS
  compatibility matrix.

[Unreleased]: https://github.com/cahva/kajo/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/cahva/kajo/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/cahva/kajo/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/cahva/kajo/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/cahva/kajo/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cahva/kajo/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cahva/kajo/releases/tag/v0.1.0
