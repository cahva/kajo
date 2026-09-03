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
  TableRecord,
  UpdateAttributes,
} from "./database.ts";
export type {
  JsonSerializable,
  JsonValue,
  KajoRequest,
  RouteHandler,
  RouteOptions,
  RouteResponder,
  RouteResult,
} from "./http.ts";
export { Collection, createSchema, model, ModelCollection } from "./model.ts";
export type {
  Model,
  ModelAttributes,
  ModelDefinition,
  ModelInstance,
  ModelRegistry,
  ModelTables,
  Pluralize,
  Schema,
} from "./model.ts";
export { createServer, Server } from "./server.ts";
export type { ServerOptions } from "./server.ts";
