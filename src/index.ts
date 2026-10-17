/**
 * A fully typed, in-memory API simulator for building and testing applications
 * without a backend. Define routes, models, factories, and serializers in
 * TypeScript, or register routes from an OpenAPI 3.1 document, and Kajo
 * intercepts `fetch` and `XMLHttpRequest` traffic in browsers and Node.js.
 *
 * Start with {@linkcode createServer}. Its options configure models, fixtures,
 * factories, serializers, and routes, and the returned {@linkcode Server}
 * handles requests until {@linkcode Server.shutdown} is called. In browsers,
 * routes default to the page's origin; set `urlPrefix` to own another origin,
 * which Node.js always needs.
 *
 * ```ts
 * import { createServer, model } from "@cahva/kajo";
 *
 * const server = createServer({
 *   urlPrefix: "https://api.example.test",
 *   models: {
 *     movie: model<{ title: string }>(),
 *   },
 *   routes() {
 *     this.namespace = "api";
 *     this.get("/movies");
 *     this.get("/movies/:id", (schema, request) => schema.movies.find(request.params.id));
 *   },
 *   seeds(server) {
 *     server.schema.movies.create({ title: "Arrival" });
 *   },
 * });
 *
 * const response = await fetch("https://api.example.test/api/movies/1");
 * await response.json(); // { movie: { id: "1", title: "Arrival" } }
 *
 * server.shutdown();
 * ```
 *
 * **Models and relationships.** Declare models with {@linkcode model}, either
 * from a TypeScript type or from any Standard JSON Schema such as Zod, Valibot,
 * or ArkType. Relate them with {@linkcode belongsTo} and {@linkcode hasMany},
 * and inverses are kept in sync.
 *
 * ```ts
 * import { belongsTo, hasMany, model } from "@cahva/kajo";
 *
 * const models = {
 *   post: model<{ title: string }>().extend({
 *     author: belongsTo("user"),
 *   }),
 *   user: model<{ name: string }>().extend({
 *     posts: hasMany("post"),
 *   }),
 * };
 * ```
 *
 * **Factories.** {@linkcode Factory} builds typed records with sequences,
 * dependent attributes, and {@linkcode trait | traits}.
 *
 * ```ts
 * import { createServer, Factory, model, trait } from "@cahva/kajo";
 *
 * interface User {
 *   name: string;
 *   role: "admin" | "member";
 * }
 *
 * createServer({
 *   factories: {
 *     user: Factory.extend<User>({
 *       name: (sequence) => `User ${sequence}`,
 *       role: "member",
 *       admin: trait<User>({ role: "admin" }),
 *     }),
 *   },
 *   models: { user: model<User>() },
 *   seeds(server) {
 *     server.createList("user", 5);
 *     server.create("user", "admin", { name: "Ada" });
 *   },
 * });
 * ```
 *
 * **OpenAPI.** Pass an OpenAPI 3.1 document as `openapi` to register its
 * operations as example-backed routes. Handlers keyed by `operationId` connect
 * operations to Kajo data, and explicit routes take precedence. Plain JSON
 * Schemas can be validated with the optional `@cahva/kajo/openapi/ajv` entry
 * point.
 *
 * ```ts
 * import { createServer, model, type OpenApiDocument } from "@cahva/kajo";
 *
 * declare const document: OpenApiDocument;
 *
 * createServer({
 *   openapi: document,
 *   models: { task: model<{ title: string }>() },
 *   openapiHandlers: {
 *     listTasks: (schema) => schema.tasks.all(),
 *     getTask: (schema, request) => schema.tasks.find(request.params.taskId),
 *   },
 * });
 * ```
 *
 * Responses go through {@linkcode Serializer} or {@linkcode RestSerializer},
 * and request activity can be observed with {@linkcode logRequestToConsole}.
 *
 * @module
 */

export type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
  StandardTypedV1,
} from "@standard-schema/spec";
export { createDatabase, IdentityManager } from "./database.ts";
export type {
  Database,
  DatabaseApi,
  DatabaseCollection,
  DatabaseCollections,
  DatabaseData,
  DatabaseOptions,
  IdentityManagerConstructor,
  IdentityManagerContract,
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
export {
  belongsTo,
  Collection,
  createSchema,
  hasMany,
  model,
  ModelCollection,
  PolymorphicCollection,
} from "./model.ts";
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
  PolymorphicBelongsToDefinition,
  PolymorphicHasManyDefinition,
  PolymorphicIdentifier,
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
export { compileOpenApiRoutes } from "./openapi.ts";
export type {
  OpenApiDocument,
  OpenApiExample,
  OpenApiInfo,
  OpenApiMediaType,
  OpenApiMethod,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiReference,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiRoute,
  OpenApiRouteContract,
  OpenApiSchema,
  OpenApiSchemaValidator,
  OpenApiSchemaValidatorContext,
  OpenApiSchemaValidatorIssue,
  OpenApiSchemaValidatorResult,
  OpenApiValidatedRequest,
  OpenApiValidationIssue,
  OpenApiValidationResult,
} from "./openapi.ts";
export { createServer, Server } from "./server.ts";
export type {
  FactoryRegistry,
  GetRouteOptions,
  IdentityManagerRegistry,
  OpenApiHandlerRegistry,
  PassthroughOptions,
  ResourceAction,
  ResourceOptions,
  ServerOptions,
  UnhandledRequestPolicy,
} from "./server.ts";
export { RestSerializer, serialize, Serializer } from "./serializer.ts";
export type {
  IncludeOption,
  SerializableModel,
  SerializationContext,
  SerializeIdsOption,
  SerializerOptions,
  SerializerRegistry,
} from "./serializer.ts";
export type { InferSchemaInput, InferSchemaOutput, KajoSchema } from "./standard-schema.ts";
