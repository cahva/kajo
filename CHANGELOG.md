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
- Typed model definitions, schema collections, persisted model instances, and
  automatic model response serialization.
- Typed `belongsTo` and `hasMany` relationships with inverse discovery,
  explicit inverses, and foreign-key synchronization.
- Application and per-model serializers with roots, attribute filtering, key
  transforms, relationship IDs, sideloading, and embedding.

[Unreleased]: https://github.com/cahva/kajo/commits/HEAD
