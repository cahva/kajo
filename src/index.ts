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
export { association, Factory, trait } from "./factory.ts";
export type {
  FactoryAssociation,
  FactoryAfterCreate,
  FactoryAttribute,
  FactoryBuild,
  FactoryDefinition,
  FactoryModel,
  FactoryServer,
  FactoryTrait,
} from "./factory.ts";
export { HttpError } from "./http.ts";
export type {
  JsonSerializable,
  JsonValue,
  KajoRequest,
  RouteHandler,
  RouteOptions,
  RouteResponder,
  RouteResult,
} from "./http.ts";
export { belongsTo, Collection, createSchema, hasMany, model, ModelCollection } from "./model.ts";
export type {
  BelongsToDefinition,
  HasManyDefinition,
  Model,
  ModelAttributes,
  ModelCreateInput,
  ModelDefinition,
  ModelFor,
  ModelInstance,
  ModelRegistry,
  ModelTables,
  NewModel,
  NewModelFor,
  NewModelInstance,
  NewModelRecord,
  Pluralize,
  RelationshipDefinition,
  RelationshipOptions,
  RelationshipRegistry,
  Schema,
  Singularize,
} from "./model.ts";
export { logRequestToConsole } from "./logging.ts";
export type {
  ErroredRequestLog,
  HandledRequestLog,
  PassthroughRequestLog,
  RequestLog,
  RequestLogBase,
  RequestLogger,
  UnhandledRequestLog,
} from "./logging.ts";
export { createServer, Server } from "./server.ts";
export type {
  FactoryRegistry,
  PassthroughOptions,
  ResourceAction,
  ResourceOptions,
  ServerOptions,
  UnhandledRequestPolicy,
} from "./server.ts";
export { serialize, Serializer } from "./serializer.ts";
export type {
  IncludeOption,
  SerializableModel,
  SerializeIdsOption,
  SerializerOptions,
  SerializerRegistry,
} from "./serializer.ts";
