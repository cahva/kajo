/**
 * A fully typed, in-memory API simulator.
 *
 * @module
 */

export { createDatabase } from "./database.ts";
export type {
  Database,
  DatabaseApi,
  DatabaseCollection,
  DatabaseCollections,
  DatabaseData,
  InsertableRecord,
  RecordQuery,
  StoredRecord,
} from "./database.ts";
export type {
  JsonValue,
  KajoRequest,
  RouteHandler,
  RouteOptions,
  RouteResponder,
  RouteResult,
  Schema,
} from "./http.ts";
export { createServer, Server } from "./server.ts";
export type { ServerOptions } from "./server.ts";
