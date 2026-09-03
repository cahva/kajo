import { createDatabase, type Database, type DatabaseData } from "./database.ts";
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
  type ModelRegistry,
  type ModelTables,
  pluralize,
  type Schema,
} from "./model.ts";
import { joinPaths, Router } from "./router.ts";

const HTTP_METHODS = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Configuration used to create a Kajo server.
 */
type ServerTables<Fixtures extends DatabaseData, Models extends ModelRegistry> = Fixtures &
  ModelTables<Models>;

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
  /** Model definitions, keyed by singular model name. */
  readonly models?: Models;
  /** Initialize additional application data. */
  readonly seeds?: (server: Server<Fixtures, Models>) => void;
}

/**
 * An in-memory API server.
 */
export class Server<
  Fixtures extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> {
  readonly #router = new Router<ServerTables<Fixtures, Models>>();
  #interceptor: NetworkInterceptor | undefined;
  #isRunning = true;

  /** A path prepended to routes registered after it is set. */
  namespace = "";

  /** Default response delay in milliseconds. */
  timing: number;

  /** The server's typed in-memory database. */
  readonly db: Database<ServerTables<Fixtures, Models>>;

  /** Data available to route handlers. */
  readonly schema: Schema<ServerTables<Fixtures, Models>>;

  constructor(options: Omit<ServerOptions<Fixtures, Models>, "routes" | "seeds"> = {}) {
    this.timing = options.timing ?? 0;
    this.db = createDatabase(options.fixtures) as Database<ServerTables<Fixtures, Models>>;

    const modelNames: Record<string, string> = {};

    for (const modelName of Object.keys(options.models ?? {})) {
      const collectionName = pluralize(modelName);
      this.db.createCollection(collectionName);
      modelNames[collectionName] = modelName;
    }

    this.schema = createSchema(this.db, modelNames);

    if (options.intercept !== false) {
      this.#interceptor = interceptRequests((request) => this.handle(request));
    }
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

    return toResponse(result);
  }

  /** Stop this server from handling requests. */
  shutdown(): void {
    this.#interceptor?.dispose();
    this.#interceptor = undefined;
    this.#isRunning = false;
  }

  delete(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.#register("DELETE", path, responder, options);
  }

  del(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.delete(path, responder, options);
  }

  get(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.#register("GET", path, responder, options);
  }

  head(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.#register("HEAD", path, responder, options);
  }

  options(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.#register("OPTIONS", path, responder, options);
  }

  patch(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.#register("PATCH", path, responder, options);
  }

  post(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.#register("POST", path, responder, options);
  }

  put(
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions = {},
  ): void {
    this.#register("PUT", path, responder, options);
  }

  #register(
    method: HttpMethod,
    path: string,
    responder: RouteResponder<ServerTables<Fixtures, Models>>,
    options: RouteOptions,
  ): void {
    this.#router.add(method, joinPaths(this.namespace, path), responder, options);
  }
}

/**
 * Create and configure an in-memory API server.
 */
export function createServer<Fixtures extends DatabaseData = {}, Models extends ModelRegistry = {}>(
  options: ServerOptions<Fixtures, Models> = {},
): Server<Fixtures, Models> {
  const server = new Server<Fixtures, Models>({
    fixtures: options.fixtures,
    intercept: options.intercept,
    models: options.models,
    timing: options.timing,
  });
  options.routes?.call(server);
  options.seeds?.(server);
  return server;
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

async function resolveResponder<Tables extends DatabaseData>(
  responder: RouteResponder<Tables>,
  request: KajoRequest,
  schema: Schema<Tables>,
): Promise<JsonSerializable | JsonValue | Response | undefined> {
  if (typeof responder === "function") {
    return (responder as RouteHandler<Tables>)(schema, request);
  }

  return responder instanceof Response ? responder.clone() : responder;
}

function toResponse(result: JsonSerializable | JsonValue | Response | undefined): Response {
  if (result instanceof Response) {
    return result;
  }

  if (result === undefined) {
    return new Response(null, { status: 204 });
  }

  return Response.json(isJsonSerializable(result) ? result.toJSON() : result);
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
