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
| **Deferred**    | Useful for some projects, but outside the initial stable core.          |
| **Different**   | Kajo deliberately uses a modern platform or TypeScript API instead.     |
| **Not planned** | The API exposes a Mirage implementation detail Kajo will not reproduce. |

Compatibility refers to behavior rather than identical syntax unless the API
name is explicitly shown. Kajo is a development tool in its 0.x phase, so even
supported APIs may still change; the changelog documents every change.

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
| XMLHttpRequest interception            | **Supported**   | Fetch and XMLHttpRequest interception run in the headless Chromium compatibility suite.            |

## Database

| Mirage capability                               | Kajo status   | Notes                                                  |
| ----------------------------------------------- | ------------- | ------------------------------------------------------ |
| Typed collections and generated IDs             | **Supported** | Numeric and string input IDs normalize to strings.     |
| `find` and multi-ID `find`                      | **Supported** | Returns one record or an ordered record array.         |
| `findBy`, `where`, and `firstOrCreate`          | **Supported** | Queries use partial typed records.                     |
| `insert`, `update`, and `remove`                | **Supported** | Single and bulk forms follow Mirage's common behavior. |
| `createCollection`, `loadData`, and `emptyData` | **Supported** | Available on the database object.                      |
| `dump`                                          | **Different** | Returns typed data rather than only logging it.        |
| Custom `IdentityManager`                        | **Supported** | Application and per-model ID generators.               |

## Models and relationships

| Mirage capability                                                  | Kajo status   | Notes                                                                                     |
| ------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------- |
| Typed `model()` definitions and schema collections                 | **Supported** | Runtime definitions are the source of relationship types.                                 |
| Persisted model `attrs`, `update`, `save`, `reload`, and `destroy` | **Supported** | Destroyed-model operations have explicit diagnostics.                                     |
| Collection `all`, `find`, `findBy`, `first`, `where`, and `create` | **Supported** | Results use typed models and iterable collections.                                        |
| Collection result operations                                       | **Supported** | Includes membership, bulk lifecycle, filtering, sorting, slicing, and string helpers.     |
| Unsaved models (`new`, `isNew`, `isSaved`)                         | **Supported** | Draft attributes and relationships are persisted when `save` or `update` is called.       |
| `findOrCreateBy` and `none` schema helpers                         | **Supported** | Helpers return typed models and collections.                                              |
| `belongsTo` and `hasMany`                                          | **Supported** | Includes inverse discovery, explicit inverses, and synchronized foreign keys.             |
| Relationship ID properties and association helpers                 | **Supported** | Includes typed setters and `new<Name>`/`create<Name>` helpers.                            |
| Polymorphic relationships                                          | **Supported** | Typed to-one and heterogeneous to-many unions, IDs, inverses, helpers, and serialization. |
| Relationship-dependent deletion behavior                           | **Supported** | Destroy clears belongs-to and stored has-many references on dependent models.             |

## Factories and data setup

| Mirage capability                                 | Kajo status   | Notes                                                                                         |
| ------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| Static and sequence attributes                    | **Supported** | Sequences are scoped to each server.                                                          |
| Dependent attributes                              | **Supported** | Factory functions lazily resolve any other attribute through `this`.                          |
| Traits and final overrides                        | **Supported** | Invalid traits and argument order have explicit errors.                                       |
| Base and trait `afterCreate` hooks                | **Supported** | Hooks receive typed models and a server context.                                              |
| `association()`                                   | **Supported** | Belongs-to targets are inferred from model definitions; traits and caller overrides work.     |
| `create` and `createList`                         | **Supported** | Return model types inferred from the model registry.                                          |
| `build` and `buildList`                           | **Different** | Kajo addition returning typed, unpersisted models that can be saved later.                    |
| Automatic dependency ordering and cycle detection | **Supported** | Attributes evaluate once in dependency order; attribute and association cycles are diagnosed. |
| Fixtures and seeds                                | **Supported** | Fixtures initialize collections and seeds can build additional state.                         |
| Selective `loadFixtures()`                        | **Supported** | Loads all configured fixtures or a typed collection-name subset.                              |

## Serializers

| Mirage capability                         | Kajo status   | Notes                                                        |
| ----------------------------------------- | ------------- | ------------------------------------------------------------ |
| Application and per-model serializers     | **Supported** | Per-model configuration takes precedence.                    |
| Root keys and attribute filtering         | **Supported** | Includes model and collection root transforms.               |
| Attribute and relationship key transforms | **Supported** | Typed option hooks cover common REST naming conventions.     |
| Embedded and sideloaded relationships     | **Supported** | Includes cycle protection and configurable relationship IDs. |
| Dynamic `include`                         | **Supported** | Receives the request and primary resource.                   |
| Generic `Serializer` extension            | **Supported** | Options and overridable methods cover common REST formats.   |
| `RestSerializer`                          | **Supported** | Rooted REST payloads with relationship IDs by default.       |
| `ActiveModelSerializer`                   | **Deferred**  | Rails-specific adapter deferred until demand.                |
| `JSONAPISerializer`                       | **Deferred**  | Spec-specific adapter deferred until demand.                 |

## Route shorthands

| Mirage capability                              | Kajo status   | Notes                                                                         |
| ---------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| GET index and show shorthands                  | **Supported** | Collection names can be inferred or specified explicitly.                     |
| POST create shorthand                          | **Supported** | Rooted and unrooted JSON bodies are normalized.                               |
| PUT/PATCH update shorthand                     | **Supported** | Missing records and malformed payloads use structured HTTP errors.            |
| DELETE shorthand                               | **Supported** | Returns an empty successful response.                                         |
| `resource()` CRUD registration                 | **Supported** | Kajo addition with `only`, `except`, and custom paths.                        |
| `normalizedRequestAttrs()` for custom handlers | **Supported** | Takes an explicit request and model name to preserve typing and async safety. |
| Coalesced GET requests                         | **Supported** | Accepts `ids=1,3` and repeated `ids=1&ids=3` OpenAPI form-array encodings.    |

## Known Mirage issues checked against Kajo

Kajo uses a different implementation than Mirage (MSW interceptors rather than
Pretender, for example), so these issues do not apply directly. They were used
as regression inputs to check that Kajo does not run into the same problems,
not as a list of fixes to port.

| Mirage issue                                                                                                  | Kajo behavior                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [#191: traits, `afterCreate`, and factory associations](https://github.com/miragejs/miragejs/issues/191)      | Declarative associations run before creation, and explicit caller relationships take precedence.                     |
| [#343: passthrough requests are altered](https://github.com/miragejs/miragejs/issues/343)                     | Passthrough preserves the URL, headers, body bytes, status, response headers, and binary response body.              |
| [#638: query strings bypass registered routes](https://github.com/miragejs/miragejs/issues/638)               | Route precedence uses the URL pathname while handlers receive parsed query parameters.                               |
| [Discuss #38: dynamic attributes evaluated twice](https://github.com/miragejs/discuss/issues/38)              | Lazy dependency resolution evaluates each factory attribute exactly once.                                            |
| [#771: missing typed `handledRequests`](https://github.com/miragejs/miragejs/issues/771)                      | Request history is a first-class typed Kajo API.                                                                     |
| [#1056: observing requests without replacing handlers](https://github.com/miragejs/miragejs/issues/1056)      | Typed logger callbacks and tracked request history observe existing routes without changing them.                    |
| [Ember #1915: binary Fetch responses are corrupted](https://github.com/miragejs/ember-cli-mirage/issues/1915) | Native byte streams are preserved for passthrough request and response bodies.                                       |
| Unrelated traffic intercepted globally                                                                        | Ownership is derived from registered route origins and namespaces; unrelated origins and paths bypass automatically. |

## Remaining work

The Mirage-style core is implemented and tested. The remaining work is the
OpenAPI convenience layer and the first release:

1. Expand the OpenAPI 3.1 route adapter with external `$ref` resolution and
   request validation.
2. Publish the first release.

OpenAPI documents can register deterministic example-backed routes, generate
response bodies from JSON Schemas, and resolve local JSON Pointers; explicit
Kajo routes remain the highest-precedence source of behavior.
