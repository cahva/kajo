# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial Vite+ library, TypeScript, testing, and JSR publishing configuration.
- Typed `createServer` API with HTTP route registration.
- Static JSON, native `Response`, and asynchronous route handlers.
- Dynamic route parameters, query parameters, request bodies, and namespaces.
- Global and per-route response timing.
- Runtime-independent request handling, passthrough, and server shutdown.
- Automatic Fetch and XMLHttpRequest interception with network passthrough.
- Typed in-memory collections with fixtures, seeds, generated IDs, queries,
  mutations, and reset behavior.
- Application-wide and per-model custom identity managers for backend-specific
  IDs.
- Typed model definitions, schema collections, persisted model instances, and
  automatic model response serialization.
- Unsaved model lifecycle with `new`, `save`, `update`, `isNew`, and `isSaved`,
  plus schema collection `findOrCreateBy` and `none` helpers.
- Typed collection membership, bulk lifecycle, filtering, sorting, slicing, and
  string helpers, including persisted `hasMany` membership changes.
- Typed `belongsTo` and `hasMany` relationships with inverse discovery,
  explicit inverses, and foreign-key synchronization.
- Typed relationship ID properties and `new<Name>`/`create<Name>` association
  helpers.
- Typed polymorphic belongs-to relationships with explicit target unions,
  `{ type, id }` identifiers, inverse synchronization, and serializer support.
- Typed polymorphic has-many relationships with heterogeneous collections,
  convenience helpers, inverse synchronization, cleanup, and serializer support.
- Automatic relationship cleanup when a model is destroyed.
- Application and per-model serializers with roots, attribute filtering, key
  transforms, relationship IDs, sideloading, and embedding.
- A `RestSerializer` preset and class-based extension hooks for root,
  attribute, and relationship ID serialization.
- Conventional CRUD route shorthands with inferred or explicit schema
  collections and normalized JSON request bodies.
- Typed `normalizedRequestAttrs()` support for sharing rooted and unrooted JSON
  normalization with custom route handlers.
- Coalesced GET shorthands supporting comma-separated and repeated OpenAPI
  `ids` array parameters.
- Runnable vanilla TypeScript task-board example covering browser interception,
  relationships, serializers, a CRUD resource, and custom handlers.
- Typed factories with sequences, order-independent dependent attributes,
  single evaluation, dependency-cycle diagnostics, traits, overrides, and list
  creation.
- Typed `build()` and `buildList()` server helpers for producing unpersisted
  factory models that can be saved later.
- Typed `loadFixtures()` support for restoring all configured fixtures or a
  selected set of fixture collections.
- Base and trait-specific factory `afterCreate` hooks.
- Declarative belongs-to factory associations with associated traits, override
  precedence, and cycle diagnostics.
- `resource()` route helper with action filters and custom paths.
- Structured JSON responses for expected `HttpError` failures, including
  shorthand `400` and `404` responses.
- Origin-aware request ownership with browser same-origin defaults, registration
  time `urlPrefix` support, strict unhandled-request diagnostics, and explicit
  method-aware `passthrough()` rules.
- Typed request diagnostics for handled, passthrough, unhandled, and errored
  requests, with parsed request bodies in an optional collapsed browser-console
  view.
- Opt-in typed request history for handled, passthrough, unhandled, and errored
  traffic, with explicit history clearing.
- A living Mirage JS compatibility matrix covering supported behavior,
  intentional differences, issue-driven fixes, and the prioritized backlog.
- Named wildcard routes, decoded static and parameter segments, consistent
  trailing-slash handling, and deterministic route specificity.
- A separate headless Chromium suite covering real Fetch and XMLHttpRequest
  interception.
- Initial OpenAPI 3.1 integration for example-backed operations, path-template
  conversion, deterministic response selection, and explicit route overrides.
- Local OpenAPI JSON Pointer resolution for path items, responses, examples,
  and schemas, with diagnostics for missing and circular references.
- Deterministic JSON Schema response generation for OpenAPI operations without
  examples, covering `const`, `default`, `enum`, composition keywords, string
  formats, and typed placeholder synthesis.
- Schema-backed model definitions using the Standard JSON Schema interface,
  including inferred persisted attributes and retained runtime metadata.

### Changed

- Unified homogeneous and polymorphic collection behavior behind one internal
  implementation while retaining target-specific compatibility checks.
- Embedded polymorphic relationships use a collision-checked, transform-aware
  `__type` discriminator, and mixed rooted/rootless polymorphic serializers are
  rejected explicitly.

### Fixed

- Added an unambiguous root command for launching the task-board example.
- Normalized polymorphic relationship identifiers across fixture reads,
  destruction cleanup, inverse synchronization, and diagnostics.
- Preserved serializer roots, transforms, filtering, and type discriminators
  for polymorphic collections and embedded relationships.
- Validated unsaved polymorphic relationships immediately and restricted bulk
  updates to attributes shared by every target model.
- Unified primary-resource serialization and iterative sideload draining so
  polymorphic roots stay stable, primary records are not duplicated, and
  transitive includes are emitted.
- Normalized the remaining inverse relationship comparisons and allowed
  explicit `undefined` relationship placeholders to be assigned before save.
- Excluded model IDs and conflicting target attribute types from polymorphic
  bulk updates.
- Added regression coverage ensuring passthrough leaves request metadata and
  binary request and response bodies unchanged.
- Added regression coverage ensuring query strings neither bypass registered
  routes nor disappear from handler request parameters.

[Unreleased]: https://github.com/cahva/kajo/commits/HEAD
