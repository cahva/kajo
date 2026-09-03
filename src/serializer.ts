import type { KajoRequest } from "./http.ts";
import {
  Collection,
  MODEL_METADATA,
  PolymorphicCollection,
  pluralize,
  singularize,
  type RelationshipDefinition,
  type RelationshipRegistry,
} from "./model.ts";

export type IncludeOption =
  | readonly string[]
  | ((request: KajoRequest, resource: SerializableModel) => readonly string[]);

export type SerializeIdsOption = "always" | "included" | "never";

export interface SerializerOptions {
  readonly attrs?: readonly string[];
  readonly embed?: boolean;
  readonly include?: IncludeOption;
  readonly root?: boolean;
  readonly serializeIds?: SerializeIdsOption;
  readonly keyForAttribute?: (attribute: string) => string;
  readonly keyForCollection?: (modelName: string) => string;
  readonly keyForEmbeddedRelationship?: (relationshipName: string) => string;
  readonly keyForForeignKey?: (relationshipName: string) => string;
  readonly keyForModel?: (modelName: string) => string;
  readonly keyForRelationship?: (modelName: string) => string;
  readonly keyForRelationshipIds?: (relationshipName: string) => string;
}

export interface SerializableModel {
  readonly attrs: Record<string, unknown>;
  readonly id: string;
  readonly modelName: string;
  readonly [MODEL_METADATA]: {
    readonly relationships: RelationshipRegistry;
  };
}

export interface SerializationContext {
  readonly includedRelationships: ReadonlySet<string>;
  readonly request: KajoRequest;
}

/**
 * Controls how models and collections become JSON response payloads.
 */
export class Serializer {
  static extend<Instance extends Serializer>(
    this: new (options?: SerializerOptions) => Instance,
    options: SerializerOptions = {},
  ): Instance {
    return new this(options);
  }

  readonly attrs: readonly string[] | undefined;
  readonly embed: boolean;
  readonly include: IncludeOption;
  readonly root: boolean;
  readonly serializeIds: SerializeIdsOption;

  readonly #options: SerializerOptions;

  constructor(options: SerializerOptions = {}) {
    this.#options = options;
    this.attrs = options.attrs;
    this.embed = options.embed ?? false;
    this.include = options.include ?? [];
    this.root = options.root ?? true;
    this.serializeIds = options.serializeIds ?? "included";
  }

  extend(options: SerializerOptions = {}): this {
    const Constructor = this.constructor as new (options?: SerializerOptions) => this;
    return new Constructor({ ...this.#options, ...options });
  }

  keyForAttribute(attribute: string): string {
    return this.#options.keyForAttribute?.(attribute) ?? attribute;
  }

  keyForCollection(modelName: string): string {
    return this.#options.keyForCollection?.(modelName) ?? pluralize(this.keyForModel(modelName));
  }

  keyForEmbeddedRelationship(relationshipName: string): string {
    return this.#options.keyForEmbeddedRelationship?.(relationshipName) ?? relationshipName;
  }

  keyForForeignKey(relationshipName: string): string {
    return this.#options.keyForForeignKey?.(relationshipName) ?? `${relationshipName}Id`;
  }

  keyForModel(modelName: string): string {
    return this.#options.keyForModel?.(modelName) ?? modelName;
  }

  keyForRelationship(modelName: string): string {
    return this.#options.keyForRelationship?.(modelName) ?? pluralize(modelName);
  }

  keyForRelationshipIds(relationshipName: string): string {
    return (
      this.#options.keyForRelationshipIds?.(relationshipName) ??
      `${singularize(relationshipName)}Ids`
    );
  }

  relationshipsToInclude(request: KajoRequest, resource: SerializableModel): readonly string[] {
    return typeof this.include === "function" ? this.include(request, resource) : this.include;
  }

  /** Return the top-level payload key for a model or collection. */
  rootKey(modelName: string, isCollection: boolean): string {
    return isCollection ? this.keyForCollection(modelName) : this.keyForModel(modelName);
  }

  /** Transform a model's persisted attributes into response fields. */
  serializeAttributes(
    resource: SerializableModel,
    relationships: RelationshipRegistry,
  ): Record<string, unknown> {
    const relationshipKeys = new Set(
      Object.entries(relationships).map(([name, relationship]) =>
        relationship.kind === "belongsTo" ? `${name}Id` : `${singularize(name)}Ids`,
      ),
    );
    const selectedAttributes = this.attrs ? new Set(this.attrs) : undefined;

    return Object.fromEntries(
      Object.entries(resource.attrs)
        .filter(
          ([name]) =>
            !relationshipKeys.has(name) && (!selectedAttributes || selectedAttributes.has(name)),
        )
        .map(([name, value]) => [this.keyForAttribute(name), value]),
    );
  }

  /** Decide whether a relationship's foreign key belongs in this resource. */
  shouldSerializeRelationshipIds(relationshipName: string, context: SerializationContext): boolean {
    return (
      !this.embed &&
      (this.serializeIds === "always" ||
        (this.serializeIds === "included" && context.includedRelationships.has(relationshipName)))
    );
  }

  /** Transform one relationship into foreign-key response fields. */
  serializeRelationshipIds(
    relationshipName: string,
    relationship: RelationshipDefinition,
    value: unknown,
  ): Record<string, unknown> {
    const models = relationshipModels(value);

    if (relationship.kind === "belongsTo") {
      const model = models[0];
      return {
        [this.keyForForeignKey(relationshipName)]:
          relationship.polymorphic === true && model
            ? { id: model.id, type: model.modelName }
            : (model?.id ?? null),
      };
    }

    return {
      [this.keyForRelationshipIds(relationshipName)]:
        relationship.polymorphic === true
          ? models.map(({ id, modelName: type }) => ({ id, type }))
          : models.map(({ id }) => id),
    };
  }
}

/**
 * Generic REST payloads with roots and relationship IDs serialized by default.
 */
export class RestSerializer extends Serializer {
  constructor(options: SerializerOptions = {}) {
    super({ serializeIds: "always", ...options });
  }
}

export type SerializerRegistry = Record<string, Serializer | undefined> & {
  readonly application?: Serializer;
};

interface Sideload {
  readonly models: Map<string, SerializableModel>;
  readonly root: string;
}

/**
 * Serialize a model or collection returned from a route handler.
 */
export function serialize(
  value: unknown,
  request: KajoRequest,
  serializers: SerializerRegistry = {},
): unknown {
  const primary = toPrimaryResource(value);

  if (!primary) {
    return value;
  }

  const sideloads = new Map<string, Sideload>();
  const visited = new Set<string>();
  const primarySerializer = serializerFor(primary.modelName, serializers);
  const data = primary.models.map((resource) =>
    serializeModel(resource, request, serializers, sideloads, visited),
  );
  const primaryData = primary.isCollection ? data : data[0];

  if (!primarySerializer.root) {
    return primaryData;
  }

  const payload: Record<string, unknown> = {
    [primarySerializer.rootKey(primary.modelName, primary.isCollection)]: primaryData,
  };

  for (const sideload of sideloads.values()) {
    payload[sideload.root] = [...sideload.models.values()].map((resource) =>
      serializeModel(resource, request, serializers, sideloads, visited),
    );
  }

  return payload;
}

function serializeModel(
  resource: SerializableModel,
  request: KajoRequest,
  serializers: SerializerRegistry,
  sideloads: Map<string, Sideload>,
  visited: Set<string>,
): Record<string, unknown> {
  const serializer = serializerFor(resource.modelName, serializers);
  const relationships = resource[MODEL_METADATA].relationships;
  const included = new Set(serializer.relationshipsToInclude(request, resource));
  const context: SerializationContext = {
    includedRelationships: included,
    request,
  };
  const json = serializer.serializeAttributes(resource, relationships);
  const identity = `${resource.modelName}:${resource.id}`;

  if (visited.has(identity)) {
    return json;
  }

  visited.add(identity);

  for (const [name, relationship] of Object.entries(relationships)) {
    const relationshipValue = Reflect.get(resource, name);
    const shouldInclude = included.has(name);

    if (serializer.shouldSerializeRelationshipIds(name, context)) {
      Object.assign(
        json,
        serializer.serializeRelationshipIds(name, relationship, relationshipValue),
      );
    }

    if (!shouldInclude) {
      continue;
    }

    const related = relationshipModels(relationshipValue);

    if (serializer.embed) {
      const embedded = related.map((model) =>
        serializeModel(model, request, serializers, sideloads, new Set(visited)),
      );
      json[serializer.keyForEmbeddedRelationship(name)] =
        relationship.kind === "belongsTo" ? (embedded[0] ?? null) : embedded;
      continue;
    }

    for (const model of related) {
      const root = serializer.keyForRelationship(model.modelName);
      const sideload = sideloads.get(root) ?? {
        models: new Map<string, SerializableModel>(),
        root,
      };
      sideload.models.set(`${model.modelName}:${model.id}`, model);
      sideloads.set(root, sideload);
    }
  }

  visited.delete(identity);
  return json;
}

function relationshipModels(value: unknown): SerializableModel[] {
  if (value instanceof Collection || value instanceof PolymorphicCollection) {
    return value.models.filter(isSerializableModel);
  }

  return isSerializableModel(value) ? [value] : [];
}

function toPrimaryResource(value: unknown):
  | {
      readonly isCollection: boolean;
      readonly modelName: string;
      readonly models: SerializableModel[];
    }
  | undefined {
  if (value instanceof Collection) {
    return {
      isCollection: true,
      modelName: value.modelName,
      models: value.models.filter(isSerializableModel),
    };
  }

  return isSerializableModel(value)
    ? {
        isCollection: false,
        modelName: value.modelName,
        models: [value],
      }
    : undefined;
}

function isSerializableModel(value: unknown): value is SerializableModel {
  const attrs =
    typeof value === "object" && value !== null ? Reflect.get(value, "attrs") : undefined;
  const id = typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined;
  const modelName =
    typeof value === "object" && value !== null ? Reflect.get(value, "modelName") : undefined;

  return (
    typeof value === "object" &&
    value !== null &&
    MODEL_METADATA in value &&
    typeof attrs === "object" &&
    attrs !== null &&
    id !== undefined &&
    typeof modelName === "string"
  );
}

function serializerFor(modelName: string, serializers: SerializerRegistry): Serializer {
  return serializers[modelName] ?? serializers.application ?? DEFAULT_SERIALIZER;
}

const DEFAULT_SERIALIZER = new Serializer();
