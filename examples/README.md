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

From the repository root:

```sh
vp install
vp run example:task-board
```
