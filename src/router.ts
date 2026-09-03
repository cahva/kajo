import type { DatabaseData } from "./database.ts";
import type { RouteOptions, RouteResponder } from "./http.ts";
import type { ModelRegistry } from "./model.ts";

type RouteSegment =
  | {
      readonly kind: "parameter" | "static";
      readonly value: string;
    }
  | {
      readonly kind: "wildcard";
      readonly value: string;
    };

export interface Route<
  Tables extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> {
  readonly method: string;
  readonly origin?: string;
  readonly path: string;
  readonly responder: RouteResponder<Tables, Models>;
  readonly segments: readonly RouteSegment[];
  readonly options: RouteOptions;
}

export interface RouteMatch<
  Tables extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> {
  readonly route: Route<Tables, Models>;
  readonly params: Readonly<Record<string, string>>;
}

export class Router<Tables extends DatabaseData = DatabaseData, Models extends ModelRegistry = {}> {
  readonly #routes: Route<Tables, Models>[] = [];

  add(
    method: string,
    path: string,
    responder: RouteResponder<Tables, Models>,
    options: RouteOptions,
    origin?: string,
  ): void {
    const normalizedPath = normalizePath(path);

    this.#routes.push({
      method: method.toUpperCase(),
      origin,
      path: normalizedPath,
      responder,
      segments: parseSegments(normalizedPath),
      options,
    });
  }

  match(method: string, url: URL): RouteMatch<Tables, Models> | undefined {
    const requestSegments = decodeRequestSegments(normalizePath(url.pathname));

    if (!requestSegments) {
      return undefined;
    }

    let bestMatch:
      | (RouteMatch<Tables, Models> & {
          readonly specificity: readonly number[];
        })
      | undefined;

    for (const route of this.#routes) {
      const wildcardIndex = route.segments.findIndex((segment) => segment.kind === "wildcard");

      if (
        route.method !== method.toUpperCase() ||
        (route.origin !== undefined && route.origin !== url.origin) ||
        (wildcardIndex === -1
          ? route.segments.length !== requestSegments.length
          : requestSegments.length <= wildcardIndex)
      ) {
        continue;
      }

      const params: Record<string, string> = {};
      let matches = true;

      for (const [index, segment] of route.segments.entries()) {
        const requestSegment = requestSegments[index];

        if (segment.kind === "wildcard") {
          params[segment.value] = requestSegments.slice(index).join("/");
          break;
        }

        if (segment.kind === "static") {
          if (segment.value !== requestSegment) {
            matches = false;
            break;
          }
        } else {
          if (!requestSegment) {
            matches = false;
            break;
          }

          params[segment.value] = requestSegment;
        }
      }

      const specificity = route.segments.map(segmentSpecificity);

      if (matches && (!bestMatch || compareSpecificity(specificity, bestMatch.specificity) >= 0)) {
        bestMatch = { route, params, specificity };
      }
    }

    return bestMatch;
  }
}

export function joinPaths(prefix: string, path: string): string {
  const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, "");
  const normalizedPath = path.trim().replace(/^\/+/, "");

  return normalizePath(normalizedPrefix ? `/${normalizedPrefix}/${normalizedPath}` : path);
}

function normalizePath(path: string): string {
  const trimmedPath = path.trim();

  if (!trimmedPath || trimmedPath === "/") {
    return "/";
  }

  return `/${trimmedPath.replace(/^\/+|\/+$/g, "")}`;
}

function parseSegments(path: string): RouteSegment[] {
  const names = new Set<string>();

  return splitPath(path).map((segment, index, segments) => {
    if (segment.startsWith(":") || segment.startsWith("*")) {
      const kind = segment.startsWith("*") ? "wildcard" : "parameter";
      const name = segment.slice(1);

      if (!name) {
        throw new TypeError(`The ${kind} segment in route "${path}" must have a name.`);
      }

      if (names.has(name)) {
        throw new TypeError(`Route "${path}" contains duplicate parameter "${name}".`);
      }

      if (kind === "wildcard" && index !== segments.length - 1) {
        throw new TypeError(`The wildcard segment in route "${path}" must be last.`);
      }

      names.add(name);
      return { kind, value: name };
    }

    return { kind: "static", value: decodeRouteSegment(segment, path) };
  });
}

function splitPath(path: string): string[] {
  return path === "/" ? [] : path.slice(1).split("/");
}

function decodeRequestSegments(path: string): string[] | undefined {
  try {
    return splitPath(path).map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
}

function decodeRouteSegment(segment: string, path: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new TypeError(`Route "${path}" contains invalid percent encoding.`);
  }
}

function segmentSpecificity(segment: RouteSegment): number {
  return segment.kind === "static" ? 3 : segment.kind === "parameter" ? 2 : 1;
}

function compareSpecificity(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}
