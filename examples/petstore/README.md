# OpenAPI-first Petstore example

This example starts from ReadMe's unmodified OpenAPI 3.1 Petstore document and
uses [`openapi-typescript`](https://openapi-ts.dev/) to generate the application
types. From the repository root:

```sh
vp install
vp run example:petstore
```

The `dev`, `check`, and `build` commands regenerate the ignored
`src/petstore.generated.ts` file before use. Run `vp run generate` inside this
directory when only the types need updating.

The example has its own TypeScript 5 dependency because `openapi-typescript`
currently uses the TypeScript 5 compiler API, while Kajo's Vite+ toolchain tests
experimental TypeScript 7.

The browser calls only paths declared by Petstore. Seeded, typed Kajo models
implement `getPetById`, `findPetsByStatus`, `addPet`, `deletePet`,
`placeOrder`, and `getOrderById` through `operationId` handlers. The inventory
button deliberately uses the unimplemented `getInventory` operation to show
Kajo's schema-generated fallback.

The optional Ajv adapter validates Petstore's imported parameter and request
body schemas before implemented handlers run.

Kajo request logging is enabled for the example. Open the browser developer
console to inspect collapsed request and response diagnostics while using the
workbench.
