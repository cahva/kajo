import type { DatabaseData } from "./database.ts";
import {
  HttpError,
  type JsonSerializable,
  type KajoRequest,
  type RouteHandler,
  type RouteResult,
} from "./http.ts";
import { pluralize, type ModelRegistry, type Schema } from "./model.ts";

export type ShorthandMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

export interface ShorthandOptions {
  /** Resolve an `ids` query parameter as a multi-record GET. */
  readonly coalesce?: boolean;
}

interface RuntimeModel extends JsonSerializable {
  destroy(): void;
  update(attributes: object): RuntimeModel;
}

interface RuntimeCollection {
  readonly modelName: string;
  all(): RouteResult;
  create(attributes: object): RouteResult;
  find(id: string): RuntimeModel | null;
  find(ids: readonly string[]): RouteResult;
}

/**
 * Build a conventional CRUD handler from a route path and optional resource
 * name. Kept separate from Server so shorthand behavior has one implementation.
 */
export function createShorthandHandler<Tables extends DatabaseData, Models extends ModelRegistry>(
  method: ShorthandMethod,
  path: string,
  resourceName?: string,
  options: ShorthandOptions = {},
): RouteHandler<Tables, Models> {
  const inferredName = resourceName ?? inferResourceName(path);

  return (schema, request) => {
    const collection = resolveCollection(schema, inferredName);

    switch (method) {
      case "GET":
        if (request.params.id) {
          return findModel(collection, request.params.id);
        }

        const ids = options.coalesce ? coalescedIds(request) : undefined;
        return ids ? collection.find(ids) : collection.all();
      case "POST":
        return collection.create(normalizedRequestAttrs(request, collection.modelName));
      case "PATCH":
      case "PUT":
        return findModel(collection, requireId(request, method)).update(
          normalizedRequestAttrs(request, collection.modelName),
        );
      case "DELETE":
        findModel(collection, requireId(request, method)).destroy();
        return undefined;
    }
  };
}

function coalescedIds(request: KajoRequest): string[] | undefined {
  const values = new URL(request.url).searchParams.getAll("ids");

  if (values.length === 0) {
    return undefined;
  }

  return values.flatMap((value) => value.split(",")).filter(Boolean);
}

function inferResourceName(path: string): string {
  const segment = path
    .split("/")
    .filter((part) => part && !part.startsWith(":"))
    .at(-1);

  if (!segment) {
    throw new Error(`Cannot infer a shorthand resource from route "${path}".`);
  }

  return segment;
}

function resolveCollection<Tables extends DatabaseData, Models extends ModelRegistry>(
  schema: Schema<Tables, Models>,
  resourceName: string,
): RuntimeCollection {
  const candidates = [...new Set([resourceName, pluralize(resourceName)])];

  for (const collectionName of candidates) {
    const collection = Reflect.get(schema, collectionName);

    if (isRuntimeCollection(collection)) {
      return collection;
    }
  }

  throw new Error(
    `Shorthand resource "${resourceName}" does not match a schema collection. ` +
      `Tried ${candidates.map((name) => `"${name}"`).join(" and ")}.`,
  );
}

function isRuntimeCollection(value: unknown): value is RuntimeCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "modelName") === "string" &&
    typeof Reflect.get(value, "all") === "function" &&
    typeof Reflect.get(value, "create") === "function" &&
    typeof Reflect.get(value, "find") === "function"
  );
}

/**
 * Parse an object request body and remove an optional resource root.
 *
 * The generic attribute type lets custom handlers retain their application
 * types without coupling normalization to a specific schema.
 */
export function normalizedRequestAttrs<Attributes extends object = Record<string, unknown>>(
  request: KajoRequest,
  modelName?: string,
): Attributes {
  if (!request.requestBody) {
    return {} as Attributes;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(request.requestBody);
  } catch {
    throw new HttpError(400, `The ${request.method} request expected a JSON request body.`);
  }

  if (!isRecord(payload)) {
    throw new HttpError(400, `The ${request.method} request expected a JSON object.`);
  }

  const rootedAttributes = modelName ? payload[modelName] : undefined;

  if (rootedAttributes !== undefined) {
    if (!isRecord(rootedAttributes)) {
      throw new HttpError(400, `The "${modelName}" request root must contain a JSON object.`);
    }

    return rootedAttributes as Attributes;
  }

  return payload as Attributes;
}

function findModel(collection: RuntimeCollection, id: string): RuntimeModel {
  const model = collection.find(id);

  if (!model) {
    throw new HttpError(404, `No ${collection.modelName} with id "${id}" was found.`);
  }

  return model;
}

function requireId(request: KajoRequest, method: ShorthandMethod): string {
  if (!request.params.id) {
    throw new Error(`The ${method} shorthand requires an ":id" route parameter.`);
  }

  return request.params.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
