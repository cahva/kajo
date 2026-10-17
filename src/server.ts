import { RequestBoundary } from "./boundary.ts";
import {
  createDatabase,
  type Database,
  type DatabaseData,
  type IdentityManagerConstructor,
} from "./database.ts";
import {
  type Factory,
  type FactoryAfterCreate,
  isFactoryAssociation,
  type FactoryModel,
  type FactoryServer,
} from "./factory.ts";
import {
  HttpError,
  type JsonSerializable,
  type JsonValue,
  type KajoRequest,
  type RouteHandler,
  type RouteOptions,
  type RouteResponder,
} from "./http.ts";
import { interceptRequests, type NetworkInterceptor } from "./interceptor.ts";
import {
  createSchema,
  type ModelAttributes,
  type ModelCreateInput,
  type ModelFor,
  type ModelRegistry,
  type ModelTables,
  type NewModelFor,
  pluralize,
  type Schema,
} from "./model.ts";
import {
  type ErroredRequestLog,
  type HandledRequestLog,
  logRequestToConsole,
  type PassthroughRequestLog,
  type RequestLog,
  type RequestLogger,
  type UnhandledRequestLog,
} from "./logging.ts";
import {
  compileOpenApiRouteContract,
  compileOpenApiRoutes,
  type OpenApiDocument,
  type OpenApiInfo,
  OpenApiOperationRegistry,
  type OpenApiRoute,
  type OpenApiRouteContract,
  type OpenApiSchemaValidator,
  validateOpenApiRequest,
} from "./openapi.ts";
import { Router } from "./router.ts";
import { serialize, type SerializerRegistry } from "./serializer.ts";
import {
  createShorthandHandler,
  normalizedRequestAttrs,
  type ShorthandOptions,
  type ShorthandMethod,
} from "./shorthand.ts";

const HTTP_METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"] as const;
const OPENAPI_RUNTIME: unique symbol = Symbol("kajo.openapi.runtime");

type HttpMethod = (typeof HTTP_METHODS)[number];
type InternalRouteOptions = GetRouteOptions & {
  readonly [OPENAPI_RUNTIME]?: {
    readonly contract: OpenApiRouteContract;
    readonly document: OpenApiDocument;
  };
};

/**
 * What happens to a request Kajo owns when no route matches: `"bypass"` lets it
 * reach the network and `"error"` rejects it.
 */
export type UnhandledRequestPolicy = "bypass" | "error";

/** Options for {@linkcode Server.passthrough}. */
export interface PassthroughOptions {
  /** Restrict this rule to these HTTP methods. */
  readonly methods?: readonly string[];
}

/** A conventional CRUD action registered by {@linkcode Server.resource}. */
export type ResourceAction = "create" | "delete" | "index" | "show" | "update";

/** Options for {@linkcode Server.resource}. */
export interface ResourceOptions {
  /** Register only these actions. */
  readonly only?: readonly ResourceAction[];
  /** Register every action except these. */
  readonly except?: readonly ResourceAction[];
  /** Override the URL path while retaining the schema collection name. */
  readonly path?: string;
}

/** Options for GET routes, including shorthand options. */
export interface GetRouteOptions extends RouteOptions, ShorthandOptions {}

type ServerTables<Fixtures extends DatabaseData, Models extends ModelRegistry> = Fixtures &
  ModelTables<Models>;

/** Factories keyed by model name. */
export type FactoryRegistry<Models extends ModelRegistry> = {
  readonly [Name in keyof Models]?: Factory<ModelAttributes<Models[Name]>, never, never>;
};

/** Identity managers keyed by collection name, with `application` as the fallback. */
export type IdentityManagerRegistry<Fixtures extends DatabaseData, Models extends ModelRegistry> = {
  readonly application?: IdentityManagerConstructor;
} & {
  readonly [Name in (keyof Fixtures | keyof Models) & string]?: IdentityManagerConstructor;
};

/** Route handlers for imported OpenAPI operations, keyed by `operationId`. */
export type OpenApiHandlerRegistry<
  Fixtures extends DatabaseData,
  Models extends ModelRegistry,
> = Readonly<Record<string, RouteHandler<ServerTables<Fixtures, Models>, Models> | undefined>>;

/**
 * Configuration used to create a Kajo server.
 */
export interface ServerOptions<
  Fixtures extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> {
  /** Register the server's HTTP routes. */
  readonly routes?: (this: Server<Fixtures, Models>) => void;
  /** Default response delay in milliseconds. */
  readonly timing?: number;
  /** Whether to intercept Fetch and XMLHttpRequest traffic. */
  readonly intercept?: boolean;
  /** Log routed requests to the console or a custom typed logger. */
  readonly logging?: boolean | RequestLogger;
  /** Retain routed requests for later inspection and test assertions. */
  readonly trackRequests?: boolean;
  /** Behavior for unmatched requests inside Kajo's owned URL boundary. */
  readonly unhandledRequest?: UnhandledRequestPolicy;
  /** Default origin or absolute base URL used by routes. */
  readonly urlPrefix?: string;
  /** Initial records, grouped by collection name. */
  readonly fixtures?: Fixtures;
  /** Factory definitions, keyed by singular model name. */
  readonly factories?: FactoryRegistry<Models>;
  /** Application, collection, and per-model identity manager constructors. */
  readonly identityManagers?: IdentityManagerRegistry<Fixtures, Models>;
  /** Model definitions, keyed by singular model name. */
  readonly models?: Models;
  /** Register example-backed routes from an OpenAPI 3.1 document. */
  readonly openapi?: OpenApiDocument;
  /** Override imported OpenAPI operations by their operationId. */
  readonly openapiHandlers?: OpenApiHandlerRegistry<Fixtures, Models>;
  /**
   * Validate plain JSON Schemas in OpenAPI operations. Imported operations are only
   * validated when this is set; Standard Schema contracts always use their own library.
   */
  readonly openapiValidator?: OpenApiSchemaValidator;
  /** Initialize additional application data. */
  readonly seeds?: (server: Server<Fixtures, Models>) => void;
  /** Application and per-model response serializers. */
  readonly serializers?: SerializerRegistry;
}

/**
 * An in-memory API server.
 */
export class Server<
  Fixtures extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> {
  readonly #router = new Router<ServerTables<Fixtures, Models>, Models>();
  readonly #boundary = new RequestBoundary();
  readonly #serializers: SerializerRegistry;
  readonly #factories: FactoryRegistry<Models>;
  readonly #fixtures: Fixtures;
  readonly #models: Models;
  readonly #openApiOperations = new OpenApiOperationRegistry();
  readonly #openApiValidator: OpenApiSchemaValidator | undefined;
  readonly #factorySequences = new Map<string, number>();
  readonly #factoryStack: string[] = [];
  readonly #requestHistory: RequestLog[] = [];
  readonly #handledRequests: HandledRequestLog[] = [];
  readonly #passthroughRequests: PassthroughRequestLog[] = [];
  readonly #unhandledRequests: UnhandledRequestLog[] = [];
  readonly #erroredRequests: ErroredRequestLog[] = [];
  readonly #trackRequests: boolean;
  readonly #unhandledRequest: UnhandledRequestPolicy;
  #interceptor: NetworkInterceptor | undefined;
  #isRunning = true;

  /** A path prepended to routes registered after it is set. */
  namespace = "";

  /** An origin or absolute base URL prepended to routes registered after it is set. */
  urlPrefix: string;

  /** Default response delay in milliseconds. */
  timing: number;

  /** Log routed requests to the console or a custom typed logger. */
  logging: boolean | RequestLogger;

  /** The server's typed in-memory database. */
  readonly db: Database<ServerTables<Fixtures, Models>>;

  /** Data available to route handlers. */
  readonly schema: Schema<ServerTables<Fixtures, Models>, Models>;

  /** Every tracked request, in the order routing decisions complete. */
  get requestHistory(): readonly RequestLog[] {
    return this.#requestHistory;
  }

  /** Requests that were handled by a registered Kajo route. */
  get handledRequests(): readonly HandledRequestLog[] {
    return this.#handledRequests;
  }

  /** Requests allowed to continue to the real network. */
  get passthroughRequests(): readonly PassthroughRequestLog[] {
    return this.#passthroughRequests;
  }

  /** Owned requests without a matching route or passthrough. */
  get unhandledRequests(): readonly UnhandledRequestLog[] {
    return this.#unhandledRequests;
  }

  /** Requests whose matched route failed unexpectedly. */
  get erroredRequests(): readonly ErroredRequestLog[] {
    return this.#erroredRequests;
  }

  /**
   * Create a server without routes or seeds. {@linkcode createServer} also
   * runs the `routes` and `seeds` options.
   */
  constructor(options: Omit<ServerOptions<Fixtures, Models>, "routes" | "seeds"> = {}) {
    this.timing = options.timing ?? 0;
    this.logging = options.logging ?? false;
    this.urlPrefix = options.urlPrefix ?? "";
    this.#unhandledRequest = options.unhandledRequest ?? "error";
    this.#serializers = options.serializers ?? {};
    this.#factories = options.factories ?? {};
    this.#fixtures = (options.fixtures ?? {}) as Fixtures;
    this.#models = (options.models ?? {}) as Models;
    this.#openApiValidator = options.openapiValidator;
    this.#trackRequests = options.trackRequests ?? false;
    const identityManagers = Object.fromEntries(
      Object.entries(options.identityManagers ?? {}).map(([name, Manager]) => [
        name in this.#models ? pluralize(name) : name,
        Manager,
      ]),
    );
    this.db = createDatabase(options.fixtures, {
      identityManagers,
    }) as Database<ServerTables<Fixtures, Models>>;

    for (const modelName of Object.keys(options.models ?? {})) {
      const collectionName = pluralize(modelName);
      this.db.createCollection(collectionName);
    }

    this.schema = createSchema(this.db, options.models);

    if (options.intercept !== false) {
      this.#interceptor = interceptRequests((request) => this.#handleIntercepted(request));
    }
  }

  /**
   * Load all configured fixtures, or only the named fixture collections.
   *
   * Existing records are preserved. Call `db.emptyData()` first when restoring
   * the configured fixture state from scratch.
   */
  loadFixtures(...fixtureNames: readonly (keyof Fixtures & string)[]): void {
    const names = fixtureNames.length > 0 ? fixtureNames : Object.keys(this.#fixtures);
    const selected: Partial<Fixtures> = {};

    for (const name of names) {
      const records = this.#fixtures[name];

      if (!records) {
        throw new Error(`No fixture collection named "${name}" is configured.`);
      }

      selected[name] = records;
    }

    this.db.loadData(selected as Partial<ServerTables<Fixtures, Models>>);
  }

  /**
   * Normalize a model's rooted or unrooted JSON request body for a custom
   * handler.
   */
  normalizedRequestAttrs<Name extends keyof Models & string>(
    request: KajoRequest,
    modelName: Name,
  ): ModelCreateInput<Models, Name> {
    return normalizedRequestAttrs<ModelCreateInput<Models, Name>>(request, modelName);
  }

  /**
   * Build one unpersisted model from its factory, traits, and overrides.
   */
  build<Name extends keyof Models & string>(
    modelName: Name,
    ...traitsAndOverrides: readonly (string | Partial<ModelCreateInput<Models, Name>>)[]
  ): NewModelFor<Models, Name> {
    if (this.#factoryStack.includes(modelName)) {
      throw new Error(
        `Factory association cycle detected: ${[...this.#factoryStack, modelName].join(" -> ")}.`,
      );
    }

    this.#factoryStack.push(modelName);

    try {
      return this.#materializeModel(modelName, traitsAndOverrides, false) as NewModelFor<
        Models,
        Name
      >;
    } finally {
      this.#factoryStack.pop();
    }
  }

  /**
   * Create one model, optionally applying factory traits and attribute
   * overrides.
   */
  create<Name extends keyof Models & string>(
    modelName: Name,
    ...traitsAndOverrides: readonly (string | Partial<ModelCreateInput<Models, Name>>)[]
  ): ModelFor<Models, Name> {
    if (this.#factoryStack.includes(modelName)) {
      throw new Error(
        `Factory association cycle detected: ${[...this.#factoryStack, modelName].join(" -> ")}.`,
      );
    }

    this.#factoryStack.push(modelName);

    try {
      return this.#materializeModel(modelName, traitsAndOverrides, true) as ModelFor<Models, Name>;
    } finally {
      this.#factoryStack.pop();
    }
  }

  #materializeModel<Name extends keyof Models & string>(
    modelName: Name,
    traitsAndOverrides: readonly (string | Partial<ModelCreateInput<Models, Name>>)[],
    persist: boolean,
  ): ModelFor<Models, Name> | NewModelFor<Models, Name> {
    const { overrides, traits } = factoryArguments(traitsAndOverrides);
    const factory = this.#factories[modelName];
    const sequence = this.#factorySequences.get(modelName) ?? 0;

    if (!factory && traits.length > 0) {
      throw new Error(`Cannot apply traits without a "${modelName}" factory.`);
    }

    const build = factory?.build(sequence, traits, overrides);
    const attributes = this.#resolveFactoryAssociations(modelName, build?.attributes ?? overrides);
    const collection = Reflect.get(this.schema, pluralize(modelName));

    if (
      typeof collection !== "object" ||
      collection === null ||
      typeof Reflect.get(collection, persist ? "create" : "new") !== "function"
    ) {
      throw new Error(`Model "${modelName}" does not have a schema collection.`);
    }

    const model = Reflect.apply(Reflect.get(collection, persist ? "create" : "new"), collection, [
      attributes,
    ]) as ModelFor<Models, Name> | NewModelFor<Models, Name>;
    this.#factorySequences.set(modelName, sequence + 1);

    for (const afterCreate of persist ? (build?.afterCreate ?? []) : []) {
      (
        afterCreate as FactoryAfterCreate<
          FactoryModel<ModelAttributes<Models[Name]>>,
          FactoryServer
        >
      )(
        model as unknown as FactoryModel<ModelAttributes<Models[Name]>>,
        this as unknown as FactoryServer,
      );
    }

    return model;
  }

  #resolveFactoryAssociations(
    modelName: keyof Models & string,
    attributes: Record<string, unknown>,
  ): Record<string, unknown> {
    const resolved = { ...attributes };
    const definition = this.#models[modelName];

    for (const [relationshipName, value] of Object.entries(resolved)) {
      if (!isFactoryAssociation(value)) {
        continue;
      }

      const relationship = definition?.relationships[relationshipName];

      if (!relationship) {
        throw new Error(
          `Factory association "${modelName}.${relationshipName}" does not match a model relationship.`,
        );
      }

      if (relationship.kind !== "belongsTo") {
        throw new Error(
          `Factory association "${modelName}.${relationshipName}" must target a belongsTo relationship.`,
        );
      }

      if (relationship.polymorphic === true) {
        throw new Error(
          `Factory association "${modelName}.${relationshipName}" is polymorphic; pass an explicit model override instead.`,
        );
      }

      resolved[relationshipName] = this.create(
        relationship.modelName as keyof Models & string,
        ...value.traits,
      );
    }

    return resolved;
  }

  /**
   * Create several models from the same factory, traits, and overrides.
   */
  createList<Name extends keyof Models & string>(
    modelName: Name,
    count: number,
    ...traitsAndOverrides: readonly (string | Partial<ModelCreateInput<Models, Name>>)[]
  ): ModelFor<Models, Name>[] {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError("Factory list count must be a non-negative integer.");
    }

    return Array.from({ length: count }, () => this.create(modelName, ...traitsAndOverrides));
  }

  /**
   * Build several unpersisted models from the same factory, traits, and
   * overrides.
   */
  buildList<Name extends keyof Models & string>(
    modelName: Name,
    count: number,
    ...traitsAndOverrides: readonly (string | Partial<ModelCreateInput<Models, Name>>)[]
  ): NewModelFor<Models, Name>[] {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError("Factory list count must be a non-negative integer.");
    }

    return Array.from({ length: count }, () => this.build(modelName, ...traitsAndOverrides));
  }

  /**
   * Handle a request without installing a runtime interceptor.
   *
   * Returns `undefined` when no route matches so an interceptor can pass the
   * request through to the network.
   */
  async handle(request: Request): Promise<Response | undefined> {
    if (!this.#isRunning) {
      return undefined;
    }

    const url = new URL(request.url);

    if (!this.#boundary.owns(url)) {
      return undefined;
    }

    return this.#dispatch(request, url);
  }

  async #handleIntercepted(request: Request): Promise<Response | undefined> {
    if (!this.#isRunning) {
      return undefined;
    }

    const url = new URL(request.url);

    if (!this.#boundary.owns(url)) {
      return undefined;
    }

    const response = await this.#dispatch(request, url);

    if (response) {
      return response;
    }

    if (this.#boundary.shouldPassthrough(request.method, url)) {
      this.#log({
        method: request.method.toUpperCase(),
        reason: "rule",
        request,
        type: "passthrough",
        url: request.url,
      });
      return undefined;
    }

    if (this.#unhandledRequest === "bypass") {
      this.#log({
        method: request.method.toUpperCase(),
        reason: "policy",
        request,
        type: "passthrough",
        url: request.url,
      });
      return undefined;
    }

    this.#log({
      method: request.method.toUpperCase(),
      request,
      type: "unhandled",
      url: request.url,
    });

    throw new Error(
      `Kajo intercepted an unhandled ${request.method.toUpperCase()} request to ${request.url}. ` +
        "Register a route or add an explicit passthrough rule.",
    );
  }

  async #dispatch(request: Request, url: URL): Promise<Response | undefined> {
    const match = this.#router.match(request.method, url);

    if (!match) {
      return undefined;
    }

    const startedAt = now();
    let routeRequest = await createRouteRequest(request, match.params, url);
    let result: JsonSerializable | JsonValue | Response | undefined;
    let response: Response;

    try {
      try {
        const runtime = (match.route.options as InternalRouteOptions)[OPENAPI_RUNTIME];
        // Imported operations only validate when an adapter is configured.
        const contract =
          match.route.options.openapi ?? (this.#openApiValidator ? runtime?.contract : undefined);
        const validation = contract
          ? await validateOpenApiRequest(contract, routeRequest, {
              document: runtime?.document,
              validator: this.#openApiValidator,
            })
          : { value: routeRequest.validated };

        if ("issues" in validation) {
          result = Response.json(
            {
              error: "OpenAPI request validation failed.",
              issues: validation.issues,
              operationId: contract?.operationId,
            },
            { status: 400 },
          );
        } else {
          routeRequest = { ...routeRequest, validated: validation.value };
          result = await resolveResponder(match.route.responder, routeRequest, this.schema);
        }
      } catch (error) {
        if (!(error instanceof HttpError)) {
          throw error;
        }

        result = Response.json({ error: error.message }, { status: error.status });
      }

      const timing = match.route.options.timing ?? this.timing;

      if (timing > 0) {
        await delay(timing);
      }

      response = toResponse(result, routeRequest, this.#serializers, match.route.options.status);
    } catch (error) {
      this.#log({
        durationMs: now() - startedAt,
        error,
        method: request.method.toUpperCase(),
        params: routeRequest.params,
        queryParams: routeRequest.queryParams,
        request,
        requestBody: routeRequest.requestBody,
        route: match.route.path,
        type: "error",
        url: request.url,
      });
      throw error;
    }

    this.#log({
      durationMs: now() - startedAt,
      method: request.method.toUpperCase(),
      params: routeRequest.params,
      queryParams: routeRequest.queryParams,
      request,
      requestBody: routeRequest.requestBody,
      response,
      route: match.route.path,
      type: "handled",
      url: request.url,
    });
    return response;
  }

  #log(entry: RequestLog): void {
    if (this.#trackRequests) {
      this.#requestHistory.push(entry);

      if (entry.type === "handled") {
        this.#handledRequests.push(entry);
      } else if (entry.type === "passthrough") {
        this.#passthroughRequests.push(entry);
      } else if (entry.type === "unhandled") {
        this.#unhandledRequests.push(entry);
      } else {
        this.#erroredRequests.push(entry);
      }
    }

    const logger = this.logging === true ? logRequestToConsole : this.logging;

    if (typeof logger === "function") {
      try {
        logger(entry);
      } catch (error) {
        console.error("[Kajo] Request logger failed.", error);
      }
    }
  }

  /** Stop this server from handling requests. */
  shutdown(): void {
    this.#interceptor?.dispose();
    this.#interceptor = undefined;
    this.#isRunning = false;
  }

  /** Remove all retained request history without changing route configuration. */
  clearRequestHistory(): void {
    this.#requestHistory.length = 0;
    this.#handledRequests.length = 0;
    this.#passthroughRequests.length = 0;
    this.#unhandledRequests.length = 0;
    this.#erroredRequests.length = 0;
  }

  /**
   * Register a DELETE route. Omit the responder to use the shorthand handler for
   * the collection named by the path.
   */
  delete(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("DELETE", path, responder, options);
  }

  /** Alias for {@linkcode Server.delete}. */
  del(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.delete(path, responder, options);
  }

  /**
   * Register a GET route. Pass options in place of the responder to configure
   * the shorthand handler for the collection named by the path.
   */
  get(
    path: string,
    responder?: GetRouteOptions | RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: GetRouteOptions = {},
  ): void {
    if (isGetRouteOptions(responder)) {
      this.#register("GET", path, undefined, responder);
      return;
    }

    this.#register("GET", path, responder, options);
  }

  /** Register a HEAD route. */
  head(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("HEAD", path, responder, options);
  }

  /** Register an OPTIONS route. */
  options(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("OPTIONS", path, responder, options);
  }

  /**
   * Register a PATCH route. Omit the responder to use the shorthand handler for
   * the collection named by the path.
   */
  patch(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("PATCH", path, responder, options);
  }

  /**
   * Register a POST route. Omit the responder to use the shorthand handler for
   * the collection named by the path.
   */
  post(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("POST", path, responder, options);
  }

  /**
   * Register a PUT route. Omit the responder to use the shorthand handler for
   * the collection named by the path.
   */
  put(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("PUT", path, responder, options);
  }

  /** Register a TRACE route. */
  trace(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("TRACE", path, responder, options);
  }

  /**
   * Register conventional index, show, create, update, and delete routes for a
   * schema collection.
   */
  resource(name: string, options: ResourceOptions = {}): void {
    if (options.only && options.except) {
      throw new TypeError('Resource options cannot combine "only" and "except".');
    }

    const collectionName = Object.prototype.hasOwnProperty.call(this.db, name)
      ? name
      : pluralize(name);
    const path = normalizeResourcePath(options.path ?? `/${collectionName}`);
    const actions = selectedResourceActions(options);

    if (actions.has("index")) {
      this.get(path, collectionName);
    }

    if (actions.has("show")) {
      this.get(`${path}/:id`, collectionName);
    }

    if (actions.has("create")) {
      this.post(path, collectionName);
    }

    if (actions.has("update")) {
      this.put(`${path}/:id`, collectionName);
      this.patch(`${path}/:id`, collectionName);
    }

    if (actions.has("delete")) {
      this.del(`${path}/:id`, collectionName);
    }
  }

  /**
   * Let an owned request continue to the real network. With no path, all
   * requests in the current URL prefix and namespace are passed through.
   */
  passthrough(path = "**", options: PassthroughOptions = {}): void {
    const address = this.#boundary.resolve(this.urlPrefix, this.namespace, path);
    this.#boundary.addPassthrough(address, options.methods);
  }

  /**
   * Register example-backed operations from an OpenAPI 3.1 document.
   *
   * Routes registered later with the same method and path take precedence.
   */
  loadOpenApi(
    document: OpenApiDocument,
    handlers: OpenApiHandlerRegistry<Fixtures, Models> = {},
  ): void {
    const routes = compileOpenApiRoutes(document);
    const operationIds = new Set(routes.map(({ operationId }) => operationId));

    for (const operationId of Object.keys(handlers)) {
      if (!operationIds.has(operationId)) {
        throw new TypeError(`No OpenAPI operation with operationId "${operationId}" was found.`);
      }
    }

    this.#openApiOperations.register(routes, { document });

    for (const route of routes) {
      this.#registerOpenApiRoute(route, handlers[route.operationId]);
    }
  }

  /** Export imported and Kajo-defined operation contracts as OpenAPI 3.1. */
  openApiDocument(info?: OpenApiInfo): OpenApiDocument {
    return this.#openApiOperations.document(info);
  }

  #registerOpenApiRoute(
    route: OpenApiRoute,
    handler: RouteHandler<ServerTables<Fixtures, Models>, Models> | undefined,
  ): void {
    this.#register(route.method, route.path, handler ?? route.response, {
      [OPENAPI_RUNTIME]: {
        contract: route.operation as OpenApiRouteContract,
        document: route.document,
      },
    });
  }

  #register(
    method: HttpMethod,
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>, Models> | undefined,
    options: InternalRouteOptions,
  ): void {
    const address = this.#boundary.resolve(this.urlPrefix, this.namespace, path);

    if (options.openapi) {
      const route = compileOpenApiRouteContract(method, address.path, options.openapi);
      this.#openApiOperations.register([route], { replace: true });
    }

    this.#boundary.own(address);

    if (responder === undefined || typeof responder === "string") {
      if (!isShorthandMethod(method)) {
        throw new TypeError(`${method} routes require a responder.`);
      }

      const routeResponder = createShorthandHandler<ServerTables<Fixtures, Models>, Models>(
        method,
        path,
        responder,
        { coalesce: options.coalesce },
      );
      const routeOptions: RouteOptions = {
        openapi: options.openapi,
        status: options.status ?? (method === "POST" ? 201 : 200),
        timing: options.timing,
      };

      this.#router.add(method, address.path, routeResponder, routeOptions, address.origin);
      return;
    }

    this.#router.add(method, address.path, responder, options, address.origin);
  }
}

const RESOURCE_ACTIONS: readonly ResourceAction[] = ["index", "show", "create", "update", "delete"];

function selectedResourceActions(options: ResourceOptions): Set<ResourceAction> {
  const only = options.only ? new Set(options.only) : undefined;
  const except = new Set(options.except ?? []);

  return new Set(
    RESOURCE_ACTIONS.filter((action) => (only ? only.has(action) : !except.has(action))),
  );
}

function normalizeResourcePath(path: string): string {
  const normalized = `/${path}`.replaceAll(/\/+/g, "/");
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isShorthandMethod(method: HttpMethod): method is ShorthandMethod {
  return (
    method === "DELETE" ||
    method === "GET" ||
    method === "PATCH" ||
    method === "POST" ||
    method === "PUT"
  );
}

function isGetRouteOptions(value: unknown): value is GetRouteOptions {
  if (typeof value !== "object" || value === null || value instanceof Response) {
    return false;
  }

  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(([key, option]) => {
      switch (key) {
        case "coalesce": {
          return typeof option === "boolean";
        }
        case "openapi": {
          return typeof option === "object" && option !== null;
        }
        case "status":
        case "timing": {
          return typeof option === "number";
        }
        default: {
          return false;
        }
      }
    })
  );
}

/**
 * Create and configure an in-memory API server.
 */
export function createServer<Fixtures extends DatabaseData = {}, Models extends ModelRegistry = {}>(
  options: ServerOptions<Fixtures, Models> = {},
): Server<Fixtures, Models> {
  const server = new Server<Fixtures, Models>({
    factories: options.factories,
    fixtures: options.fixtures,
    identityManagers: options.identityManagers,
    intercept: options.intercept,
    logging: options.logging,
    models: options.models,
    openapiValidator: options.openapiValidator,
    serializers: options.serializers,
    timing: options.timing,
    trackRequests: options.trackRequests,
    unhandledRequest: options.unhandledRequest,
    urlPrefix: options.urlPrefix,
  });
  if (options.openapi) {
    server.loadOpenApi(options.openapi, options.openapiHandlers);
  }
  options.routes?.call(server);
  options.seeds?.(server);
  return server;
}

function factoryArguments(args: readonly (object | string)[]): {
  overrides: Record<string, unknown>;
  traits: string[];
} {
  const traits: string[] = [];
  let overrides: Record<string, unknown> = {};
  let hasOverrides = false;

  for (const argument of args) {
    if (typeof argument === "string") {
      if (hasOverrides) {
        throw new TypeError("Factory traits must be listed before attribute overrides.");
      }

      traits.push(argument);
      continue;
    }

    if (hasOverrides || Array.isArray(argument)) {
      throw new TypeError("A factory accepts at most one attribute override object.");
    }

    overrides = { ...argument };
    hasOverrides = true;
  }

  return { overrides, traits };
}

async function createRouteRequest(
  request: Request,
  params: Readonly<Record<string, string>>,
  url: URL,
): Promise<KajoRequest> {
  return {
    original: request,
    method: request.method.toUpperCase(),
    url: request.url,
    params,
    queryParams: Object.fromEntries(url.searchParams),
    requestBody: await request.clone().text(),
    validated: {
      parameters: {
        cookie: {},
        header: {},
        path: {},
        query: {},
      },
    },
  };
}

async function resolveResponder<Tables extends DatabaseData, Models extends ModelRegistry>(
  responder: RouteResponder<Tables, Models>,
  request: KajoRequest,
  schema: Schema<Tables, Models>,
): Promise<JsonSerializable | JsonValue | Response | undefined> {
  if (typeof responder === "function") {
    return (responder as RouteHandler<Tables, Models>)(schema, request);
  }

  return responder instanceof Response ? responder.clone() : responder;
}

function toResponse(
  result: JsonSerializable | JsonValue | Response | undefined,
  request: KajoRequest,
  serializers: SerializerRegistry,
  status?: number,
): Response {
  if (result instanceof Response) {
    return result;
  }

  if (result === undefined) {
    return new Response(null, { status: status ?? 204 });
  }

  const serialized = serialize(result, request, serializers);

  return Response.json(isJsonSerializable(serialized) ? serialized.toJSON() : serialized, {
    status,
  });
}

function isJsonSerializable(value: unknown): value is JsonSerializable {
  return (
    typeof value === "object" &&
    value !== null &&
    "toJSON" in value &&
    typeof value.toJSON === "function"
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}
