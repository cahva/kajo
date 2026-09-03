import type { RouteOptions, RouteResponder } from "./http.ts";

interface RouteSegment {
  readonly kind: "parameter" | "static";
  readonly value: string;
}

export interface Route {
  readonly method: string;
  readonly path: string;
  readonly responder: RouteResponder;
  readonly segments: readonly RouteSegment[];
  readonly options: RouteOptions;
}

export interface RouteMatch {
  readonly route: Route;
  readonly params: Readonly<Record<string, string>>;
}

export class Router {
  readonly #routes: Route[] = [];

  add(method: string, path: string, responder: RouteResponder, options: RouteOptions): void {
    const normalizedPath = normalizePath(path);

    this.#routes.push({
      method: method.toUpperCase(),
      path: normalizedPath,
      responder,
      segments: parseSegments(normalizedPath),
      options,
    });
  }

  match(method: string, path: string): RouteMatch | undefined {
    const requestSegments = splitPath(normalizePath(path));
    let bestMatch: (RouteMatch & { readonly staticSegmentCount: number }) | undefined;

    for (const route of this.#routes) {
      if (
        route.method !== method.toUpperCase() ||
        route.segments.length !== requestSegments.length
      ) {
        continue;
      }

      const params: Record<string, string> = {};
      let matches = true;
      let staticSegmentCount = 0;

      for (const [index, segment] of route.segments.entries()) {
        const requestSegment = requestSegments[index];

        if (segment.kind === "static") {
          if (segment.value !== requestSegment) {
            matches = false;
            break;
          }

          staticSegmentCount += 1;
        } else {
          params[segment.value] = decodeURIComponent(requestSegment);
        }
      }

      if (matches && (!bestMatch || staticSegmentCount > bestMatch.staticSegmentCount)) {
        bestMatch = { route, params, staticSegmentCount };
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
  return splitPath(path).map((segment) =>
    segment.startsWith(":")
      ? { kind: "parameter", value: segment.slice(1) }
      : { kind: "static", value: segment },
  );
}

function splitPath(path: string): string[] {
  return path === "/" ? [] : path.slice(1).split("/");
}
