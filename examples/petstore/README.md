# OpenAPI-first Petstore example

This example starts from ReadMe's unmodified OpenAPI 3.1 Petstore document and
uses [`openapi-typescript`](https://openapi-ts.dev/) to generate the application
types:

```sh
vp run generate
```

The example has its own TypeScript 5 dependency because `openapi-typescript`
currently uses the TypeScript 5 compiler API, while Kajo's Vite+ toolchain tests
experimental TypeScript 7.

The generated types, browser UI, seeded Kajo models, and `operationId` handlers
will be added incrementally under
[issue #3](https://github.com/cahva/kajo/issues/3).
