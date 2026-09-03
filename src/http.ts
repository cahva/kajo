import type { DatabaseData } from "./database.ts";
import type { ModelRegistry, Schema } from "./model.ts";

/**
 * A JSON value that can be returned directly from a route handler.
 */
export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The request information passed to a route handler.
 */
export interface KajoRequest {
  /** The original platform request. */
  readonly original: Request;
  /** The request method, normalized to uppercase. */
  readonly method: string;
  /** The full request URL. */
  readonly url: string;
  /** Dynamic segments matched from the route path. */
  readonly params: Readonly<Record<string, string>>;
  /** Query string values. Repeated keys use their final value. */
  readonly queryParams: Readonly<Record<string, string>>;
  /** The request body as text. */
  readonly requestBody: string;
}

/**
 * A value that provides its JSON representation.
 */
export interface JsonSerializable {
  toJSON(): unknown;
}

/**
 * A value Kajo can turn into an HTTP response.
 */
export type RouteResult = JsonSerializable | JsonValue | Response | undefined;

/**
 * Produces a response for a matched request.
 */
export type RouteHandler<
  Tables extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> = (schema: Schema<Tables, Models>, request: KajoRequest) => RouteResult | Promise<RouteResult>;

/**
 * A route handler or a static JSON response.
 */
export type RouteResponder<
  Tables extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> = JsonSerializable | JsonValue | Response | RouteHandler<Tables, Models>;

/**
 * Per-route behavior.
 */
export interface RouteOptions {
  /** Delay the response by this many milliseconds. */
  readonly timing?: number;
}
