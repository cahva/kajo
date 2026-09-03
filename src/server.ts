import { createDatabase, type Database, type DatabaseData } from "./database.ts";
import type { Factory } from "./factory.ts";
import type {
  JsonSerializable,
  JsonValue,
  KajoRequest,
  RouteHandler,
  RouteOptions,
  RouteResponder,
} from "./http.ts";
import { interceptRequests, type NetworkInterceptor } from "./interceptor.ts";
import {
  createSchema,
  type ModelAttributes,
  type ModelCreateInput,
  type ModelFor,
  type ModelRegistry,
  type ModelTables,
  pluralize,
  type Schema,
} from "./model.ts";
import { joinPaths, Router } from "./router.ts";
import { serialize, type SerializerRegistry } from "./serializer.ts";
import { createShorthandHandler, type ShorthandMethod } from "./shorthand.ts";

const HTTP_METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Configuration used to create a Kajo server.
 */
type ServerTables<Fixtures extends DatabaseData, Models extends ModelRegistry> = Fixtures &
  ModelTables<Models>;

export type FactoryRegistry<Models extends ModelRegistry> = {
  readonly [Name in keyof Models]?: Factory<ModelAttributes<Models[Name]>>;
};

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
  /** Initial records, grouped by collection name. */
  readonly fixtures?: Fixtures;
  /** Factory definitions, keyed by singular model name. */
  readonly factories?: FactoryRegistry<Models>;
  /** Model definitions, keyed by singular model name. */
  readonly models?: Models;
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
  readonly #serializers: SerializerRegistry;
  readonly #factories: FactoryRegistry<Models>;
  readonly #factorySequences = new Map<string, number>();
  #interceptor: NetworkInterceptor | undefined;
  #isRunning = true;

  /** A path prepended to routes registered after it is set. */
  namespace = "";

  /** Default response delay in milliseconds. */
  timing: number;

  /** The server's typed in-memory database. */
  readonly db: Database<ServerTables<Fixtures, Models>>;

  /** Data available to route handlers. */
  readonly schema: Schema<ServerTables<Fixtures, Models>, Models>;

  constructor(options: Omit<ServerOptions<Fixtures, Models>, "routes" | "seeds"> = {}) {
    this.timing = options.timing ?? 0;
    this.#serializers = options.serializers ?? {};
    this.#factories = options.factories ?? {};
    this.db = createDatabase(options.fixtures) as Database<ServerTables<Fixtures, Models>>;

    for (const modelName of Object.keys(options.models ?? {})) {
      const collectionName = pluralize(modelName);
      this.db.createCollection(collectionName);
    }

    this.schema = createSchema(this.db, options.models);

    if (options.intercept !== false) {
      this.#interceptor = interceptRequests((request) => this.handle(request));
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
    const { overrides, traits } = factoryArguments(traitsAndOverrides);
    const factory = this.#factories[modelName];
    const sequence = this.#factorySequences.get(modelName) ?? 0;

    if (!factory && traits.length > 0) {
      throw new Error(`Cannot apply traits without a "${modelName}" factory.`);
    }

    const attributes = factory ? factory.build(sequence, traits, overrides).attributes : overrides;
    const collection = Reflect.get(this.schema, pluralize(modelName));

    if (
      typeof collection !== "object" ||
      collection === null ||
      typeof Reflect.get(collection, "create") !== "function"
    ) {
      throw new Error(`Model "${modelName}" does not have a schema collection.`);
    }

    const created = Reflect.apply(Reflect.get(collection, "create"), collection, [
      attributes,
    ]) as ModelFor<Models, Name>;
    this.#factorySequences.set(modelName, sequence + 1);
    return created;
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
    const match = this.#router.match(request.method, url.pathname);

    if (!match) {
      return undefined;
    }

    const routeRequest = await createRouteRequest(request, match.params, url);
    const result = await resolveResponder(match.route.responder, routeRequest, this.schema);
    const timing = match.route.options.timing ?? this.timing;

    if (timing > 0) {
      await delay(timing);
    }

    return toResponse(result, routeRequest, this.#serializers, match.route.options.status);
  }

  /** Stop this server from handling requests. */
  shutdown(): void {
    this.#interceptor?.dispose();
    this.#interceptor = undefined;
    this.#isRunning = false;
  }

  delete(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("DELETE", path, responder, options);
  }

  del(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.delete(path, responder, options);
  }

  get(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("GET", path, responder, options);
  }

  head(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("HEAD", path, responder, options);
  }

  options(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("OPTIONS", path, responder, options);
  }

  patch(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("PATCH", path, responder, options);
  }

  post(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("POST", path, responder, options);
  }

  put(
    path: string,
    responder?: RouteResponder<ServerTables<Fixtures, Models>, Models>,
    options: RouteOptions = {},
  ): void {
    this.#register("PUT", path, responder, options);
  }

  #register(
    method: HttpMethod,
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>, Models> | undefined,
    options: RouteOptions,
  ): void {
    if (responder === undefined || typeof responder === "string") {
      if (!isShorthandMethod(method)) {
        throw new TypeError(`${method} routes require a responder.`);
      }

      const routeResponder = createShorthandHandler<ServerTables<Fixtures, Models>, Models>(
        method,
        path,
        responder,
      );
      const routeOptions =
        options.status === undefined
          ? { ...options, status: method === "POST" ? 201 : 200 }
          : options;

      this.#router.add(method, joinPaths(this.namespace, path), routeResponder, routeOptions);
      return;
    }

    this.#router.add(method, joinPaths(this.namespace, path), responder, options);
  }
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

/**
 * Create and configure an in-memory API server.
 */
export function createServer<Fixtures extends DatabaseData = {}, Models extends ModelRegistry = {}>(
  options: ServerOptions<Fixtures, Models> = {},
): Server<Fixtures, Models> {
  const server = new Server<Fixtures, Models>({
    factories: options.factories,
    fixtures: options.fixtures,
    intercept: options.intercept,
    models: options.models,
    serializers: options.serializers,
    timing: options.timing,
  });
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
