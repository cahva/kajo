import { isReference } from "./references.ts";
import type { OpenApiDocument, OpenApiInfo, OpenApiRoute } from "./types.ts";

export class OpenApiOperationRegistry {
  readonly #byIdentity = new Map<string, OpenApiRoute>();
  readonly #byOperationId = new Map<string, OpenApiRoute>();
  readonly #documents: OpenApiDocument[] = [];

  register(
    routes: readonly OpenApiRoute[],
    options: { readonly document?: OpenApiDocument; readonly replace?: boolean } = {},
  ): void {
    const identities = new Set<string>();
    const operationIds = new Set<string>();

    for (const route of routes) {
      const identity = `${route.method} ${route.path}`;
      const existingIdentity = this.#byIdentity.get(identity);
      const existingOperation = this.#byOperationId.get(route.operationId);

      if ((!options.replace && existingIdentity) || identities.has(identity)) {
        throw new TypeError(`OpenAPI operation "${identity}" is already registered.`);
      }

      if (
        (!options.replace && existingOperation) ||
        (existingOperation && existingOperation !== existingIdentity) ||
        operationIds.has(route.operationId)
      ) {
        throw new TypeError(`OpenAPI operationId "${route.operationId}" is already registered.`);
      }

      identities.add(identity);
      operationIds.add(route.operationId);
    }

    for (const route of routes) {
      const identity = `${route.method} ${route.path}`;
      const replaced = this.#byIdentity.get(identity);

      if (replaced) {
        this.#byOperationId.delete(replaced.operationId);
      }

      this.#byIdentity.set(identity, route);
      this.#byOperationId.set(route.operationId, route);
    }

    if (options.document) {
      this.#documents.push(options.document);
    }
  }

  document(info?: OpenApiInfo): OpenApiDocument {
    if (this.#documents.length > 1) {
      throw new TypeError("Cannot export more than one imported OpenAPI document yet.");
    }

    const imported = this.#documents[0];
    const documentInfo = info ?? imported?.info;

    if (!documentInfo) {
      throw new TypeError("OpenAPI export requires an info object with a title and version.");
    }

    const paths: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(imported?.paths ?? {}).flatMap(([path, pathItem]) =>
        pathItem ? [[path, isReference(pathItem) ? pathItem : { ...pathItem }]] : [],
      ),
    );

    for (const route of this.#byIdentity.values()) {
      if (route.source === "openapi") {
        continue;
      }

      const existing = paths[route.openApiPath];

      if (existing && isReference(existing)) {
        throw new TypeError(
          `Cannot replace operation in referenced OpenAPI path item "${route.openApiPath}".`,
        );
      }

      const pathItem = (paths[route.openApiPath] ??= {});
      pathItem[route.method.toLowerCase()] = route.operation;
    }

    return {
      ...imported,
      info: documentInfo,
      openapi: imported?.openapi ?? "3.1.0",
      paths: paths as OpenApiDocument["paths"],
    };
  }
}
