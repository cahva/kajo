# Mirage JS compatibility

Kajo aims to provide the capabilities and developer experience of Mirage JS,
not a byte-for-byte implementation of its internals. This document is the
living inventory used to plan compatibility work and make intentional
differences visible.

## Status definitions

| Status          | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| **Supported**   | The common Mirage behavior has a tested Kajo equivalent.                |
| **Partial**     | The main use case works, but documented Mirage behavior remains.        |
| **Planned**     | The capability belongs in Kajo but has not been implemented yet.        |
| **Different**   | Kajo deliberately uses a modern platform or TypeScript API instead.     |
| **Not planned** | The API exposes a Mirage implementation detail Kajo will not reproduce. |

Compatibility refers to behavior rather than identical syntax unless the API
name is explicitly shown. Kajo is still pre-release, so even supported APIs may
change before the first stable version.

## Server and HTTP

| Mirage capability                      | Kajo status     | Notes                                                                                              |
| -------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `createServer()` and `Server`          | **Supported**   | Typed fixtures, models, factories, serializers, routes, and seeds.                                 |
| HTTP verb route helpers                | **Supported**   | `get`, `post`, `put`, `patch`, `delete`/`del`, `head`, and `options`.                              |
| Static, function, and async handlers   | **Supported**   | Handlers may return JSON values, models, collections, or native responses.                         |
| Dynamic `:params` and query parameters | **Supported**   | Available through the typed `KajoRequest`.                                                         |
| Wildcard route segments                | **Supported**   | A final `*name` captures one or more decoded path segments.                                        |
| `namespace` and `urlPrefix`            | **Supported**   | Values apply at route registration time, matching Mirage's useful behavior.                        |
| Global and per-route `timing`          | **Supported**   | Defaults to `0`; Kajo does not guess the runtime environment.                                      |
| `passthrough()`                        | **Supported**   | Includes globs and method restrictions. Registered routes take precedence.                         |
| Unhandled request errors               | **Supported**   | Strict inside owned boundaries; `unhandledRequest: "bypass"` is available for migration.           |
| Request logging                        | **Supported**   | `logging: true` or a typed logger; includes route, duration, body, response, and failure category. |
| `trackRequests`                        | **Supported**   | Typed history for handled, passthrough, unhandled, and errored requests.                           |
| `environment` and test-mode defaults   | **Different**   | Kajo favors explicit timing, logging, and tracking options over environment-sensitive behavior.    |
| Pretender access and hooks             | **Not planned** | Kajo uses MSW interceptors and exposes typed logging and request history instead.                  |
| Mirage `Response` class                | **Different**   | Return the standard web `Response`; use `HttpError` for expected JSON failures.                    |
| Fetch interception                     | **Supported**   | Requests outside Kajo's registered origin and path boundaries are ignored.                         |
| XMLHttpRequest interception            | **Partial**     | Installed through MSW interceptors; automated real-browser coverage is still planned.              |

## Database

| Mirage capability                               | Kajo status   | Notes                                                  |
| ----------------------------------------------- | ------------- | ------------------------------------------------------ |
| Typed collections and generated IDs             | **Supported** | Numeric and string input IDs normalize to strings.     |
| `find` and multi-ID `find`                      | **Supported** | Returns one record or an ordered record array.         |
| `findBy`, `where`, and `firstOrCreate`          | **Supported** | Queries use partial typed records.                     |
| `insert`, `update`, and `remove`                | **Supported** | Single and bulk forms follow Mirage's common behavior. |
| `createCollection`, `loadData`, and `emptyData` | **Supported** | Available on the database object.                      |
| `dump`                                          | **Different** | Returns typed data rather than only logging it.        |
| Custom `IdentityManager`                        | **Planned**   | Needed for UUIDs and backend-specific ID generation.   |

## Models and relationships

| Mirage capability                                                  | Kajo status   | Notes                                                                                 |
| ------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------- |
| Typed `model()` definitions and schema collections                 | **Supported** | Runtime definitions are the source of relationship types.                             |
| Persisted model `attrs`, `update`, `save`, `reload`, and `destroy` | **Supported** | Destroyed-model operations have explicit diagnostics.                                 |
| Collection `all`, `find`, `findBy`, `first`, `where`, and `create` | **Supported** | Results use typed models and iterable collections.                                    |
| Unsaved models (`new`, `isNew`, `isSaved`)                         | **Planned**   | Current model instances are always persisted.                                         |
| `findOrCreateBy` and `none` schema helpers                         | **Planned**   | Database-level `firstOrCreate` is already available.                                  |
| `belongsTo` and `hasMany`                                          | **Supported** | Includes inverse discovery, explicit inverses, and synchronized foreign keys.         |
| Relationship ID properties and association helpers                 | **Partial**   | Foreign keys are persisted, but Mirage's full dynamic convenience API is not exposed. |
| Polymorphic relationships                                          | **Planned**   | Requires typed unions and serializer support.                                         |
| Relationship-dependent deletion behavior                           | **Partial**   | Core synchronization works; broader parity cases need a compatibility suite.          |

## Factories and data setup

| Mirage capability                                 | Kajo status   | Notes                                                                                         |
| ------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| Static and sequence attributes                    | **Supported** | Sequences are scoped to each server.                                                          |
| Dependent attributes                              | **Supported** | Factory functions can read attributes evaluated before them through `this`.                   |
| Traits and final overrides                        | **Supported** | Invalid traits and argument order have explicit errors.                                       |
| Base and trait `afterCreate` hooks                | **Supported** | Hooks receive typed models and a server context.                                              |
| `association()`                                   | **Supported** | Belongs-to targets are inferred from model definitions; traits and caller overrides work.     |
| `create` and `createList`                         | **Supported** | Return model types inferred from the model registry.                                          |
| Automatic dependency ordering and cycle detection | **Partial**   | Association cycles are diagnosed; arbitrary dependent-attribute ordering is not yet resolved. |
| Fixtures and seeds                                | **Supported** | Fixtures initialize collections and seeds can build additional state.                         |
| Selective `loadFixtures()`                        | **Planned**   | Direct `db.loadData()` is available today.                                                    |

## Serializers

| Mirage capability                         | Kajo status   | Notes                                                              |
| ----------------------------------------- | ------------- | ------------------------------------------------------------------ |
| Application and per-model serializers     | **Supported** | Per-model configuration takes precedence.                          |
| Root keys and attribute filtering         | **Supported** | Includes model and collection root transforms.                     |
| Attribute and relationship key transforms | **Supported** | Typed option hooks cover common REST naming conventions.           |
| Embedded and sideloaded relationships     | **Supported** | Includes cycle protection and configurable relationship IDs.       |
| Dynamic `include`                         | **Supported** | Receives the request and primary resource.                         |
| Generic `Serializer` extension            | **Partial**   | Common options are covered; Mirage's complete hook surface is not. |
| `RestSerializer`                          | **Planned**   | The base serializer already covers much of this format.            |
| `ActiveModelSerializer`                   | **Planned**   | Requires underscore key conventions and AMS relationship behavior. |
| `JSONAPISerializer`                       | **Planned**   | A dedicated spec-compliant serializer is required.                 |

## Route shorthands

| Mirage capability                              | Kajo status   | Notes                                                                           |
| ---------------------------------------------- | ------------- | ------------------------------------------------------------------------------- |
| GET index and show shorthands                  | **Supported** | Collection names can be inferred or specified explicitly.                       |
| POST create shorthand                          | **Supported** | Rooted and unrooted JSON bodies are normalized.                                 |
| PUT/PATCH update shorthand                     | **Supported** | Missing records and malformed payloads use structured HTTP errors.              |
| DELETE shorthand                               | **Supported** | Returns an empty successful response.                                           |
| `resource()` CRUD registration                 | **Supported** | Kajo addition with `only`, `except`, and custom paths.                          |
| `normalizedRequestAttrs()` for custom handlers | **Planned**   | Shorthands normalize internally; custom handlers currently parse `requestBody`. |
| Coalesced GET requests                         | **Planned**   | Depends on serializer and query compatibility decisions.                        |

## Known Mirage issues already addressed

These are behavioral inputs, not commitments to preserve Mirage internals.

| Mirage issue                                                                                             | Kajo behavior                                                                                                        |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [#191: traits, `afterCreate`, and factory associations](https://github.com/miragejs/miragejs/issues/191) | Declarative associations run before creation, and explicit caller relationships take precedence.                     |
| [#771: missing typed `handledRequests`](https://github.com/miragejs/miragejs/issues/771)                 | Request history is a first-class typed Kajo API.                                                                     |
| [#1056: observing requests without replacing handlers](https://github.com/miragejs/miragejs/issues/1056) | Typed logger callbacks and tracked request history observe existing routes without changing them.                    |
| Unrelated traffic intercepted globally                                                                   | Ownership is derived from registered route origins and namespaces; unrelated origins and paths bypass automatically. |

## Prioritized compatibility work

1. Add browser-level Fetch and XMLHttpRequest integration tests for routing and
   interception.
2. Fill schema and model lifecycle gaps, especially unsaved models and
   relationship ID APIs.
3. Add dedicated REST, ActiveModel, and JSON:API serializers.
4. Add polymorphic relationships and their serializer behavior.
5. Add configurable identity managers and selective fixture loading.
6. Expand the issue-driven regression suite before declaring a stable API.

OpenAPI integration starts after this compatibility foundation is stable.
