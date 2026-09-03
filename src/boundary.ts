import { joinPaths } from "./router.ts";

export interface RequestAddress {
  readonly origin?: string;
  readonly path: string;
  readonly scope: string;
}

interface RequestScope {
  readonly origin?: string;
  readonly path: string;
}

interface PassthroughRule {
  readonly methods?: readonly string[];
  readonly origin?: string;
  readonly path: RegExp;
}

/**
 * Tracks which URLs belong to Kajo and which owned URLs should reach the
 * network.
 */
export class RequestBoundary {
  readonly #defaultOrigin = browserOrigin();
  readonly #ownedScopes: RequestScope[] = [];
  readonly #passthroughRules: PassthroughRule[] = [];

  resolve(urlPrefix: string, namespace: string, path: string): RequestAddress {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
      const url = new URL(path);
      return {
        origin: url.origin,
        path: normalizePath(url.pathname),
        scope: "/",
      };
    }

    let basePath = "";
    let origin = this.#defaultOrigin;

    if (urlPrefix) {
      let prefix: URL;

      try {
        prefix = new URL(urlPrefix);
      } catch {
        throw new TypeError(`The urlPrefix "${urlPrefix}" must be an absolute URL.`);
      }

      basePath = prefix.pathname;
      origin = prefix.origin;
    }

    const scope = joinPaths(basePath, namespace);

    return {
      origin,
      path: joinPaths(scope, path),
      scope,
    };
  }

  own(address: RequestAddress): void {
    const scope = {
      origin: address.origin,
      path: address.scope,
    };

    if (
      !this.#ownedScopes.some(
        (candidate) => candidate.origin === scope.origin && candidate.path === scope.path,
      )
    ) {
      this.#ownedScopes.push(scope);
    }
  }

  owns(url: URL): boolean {
    return this.#ownedScopes.some(
      (scope) =>
        (scope.origin === undefined || scope.origin === url.origin) &&
        pathIsInside(url.pathname, scope.path),
    );
  }

  addPassthrough(address: RequestAddress, methods?: readonly string[]): void {
    this.#passthroughRules.push({
      methods: methods?.map((method) => method.toUpperCase()),
      origin: address.origin,
      path: globToRegExp(address.path),
    });
  }

  shouldPassthrough(method: string, url: URL): boolean {
    return this.#passthroughRules.some(
      (rule) =>
        (rule.origin === undefined || rule.origin === url.origin) &&
        (!rule.methods || rule.methods.includes(method.toUpperCase())) &&
        rule.path.test(url.pathname),
    );
  }
}

function browserOrigin(): string | undefined {
  const location = Reflect.get(globalThis, "location");
  const origin =
    typeof location === "object" && location !== null ? Reflect.get(location, "origin") : undefined;

  return typeof origin === "string" && origin !== "null" ? origin : undefined;
}

function normalizePath(path: string): string {
  const normalized = `/${path}`.replaceAll(/\/+/g, "/");
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function pathIsInside(path: string, scope: string): boolean {
  return scope === "/" || path === scope || path.startsWith(`${scope}/`);
}

function globToRegExp(glob: string): RegExp {
  let expression = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]!;

    if (character === "/" && glob.slice(index) === "/**") {
      expression += "(?:/.*)?";
      break;
    }

    if (character === "*") {
      if (glob[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else {
      expression += /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
    }
  }

  return new RegExp(`${expression}$`);
}
