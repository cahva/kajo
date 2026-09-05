# Kajo examples

These applications use Kajo as a consumer would and double as manual
integration tests for complete browser workflows.

## Task board

A framework-neutral TypeScript app with users, assigned tasks, a CRUD
`resource()`, relationships, serializers, and a custom summary endpoint. The
same frontend and server configuration can use Zod, Valibot, or ArkType model
schemas. Switch implementation with the links in the example or the `schema`
query parameter:

```text
http://localhost:5173/?schema=zod
http://localhost:5173/?schema=valibot
http://localhost:5173/?schema=arktype
```

Create and update requests are validated by the selected schema implementation
before their handlers run. Use the **OpenAPI ↓** action in the running app to
download the generated OpenAPI 3.1 document.

The app fetches that document from `/api/openapi.json`. Opening the endpoint as
a browser page does not work because Kajo starts intercepting requests only
after the application has loaded; an initial navigation is handled by Vite.

From the repository root:

```sh
vp install
vp run example:task-board
```
