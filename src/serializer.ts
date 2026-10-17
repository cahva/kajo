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

/** Relationships to include, as a list of names or a function of the request and resource. */
export type IncludeOption =
  | readonly string[]
  | ((request: KajoRequest, resource: SerializableModel) => readonly string[]);

/**
 * When to add relationship IDs to a payload: always, only for included
 * relationships, or never.
 */
export type SerializeIdsOption = "always" | "included" | "never";

/** Options for a {@linkcode Serializer}. */
export interface SerializerOptions {
  /** Attributes to serialize. All attributes are serialized when omitted. */
  readonly attrs?: readonly string[];
  /** Embed included relationships instead of sideloading them. Defaults to `false`. */
  readonly embed?: boolean;
  /** Relationships to include in the payload. */
  readonly include?: IncludeOption;
  /** Wrap the payload in a key named after the model. Defaults to `true`. */
  readonly root?: boolean;
  /** When to add relationship IDs. Defaults to `"included"`. */
  readonly serializeIds?: SerializeIdsOption;
  /** Transform an attribute name into a payload key. */
  readonly keyForAttribute?: (attribute: string) => string;
  /** Return the root key for a collection of this model. Defaults to the plural model key. */
  readonly keyForCollection?: (modelName: string) => string;
  /** Return the key for an embedded relationship. Defaults to the relationship name. */
  readonly keyForEmbeddedRelationship?: (relationshipName: string) => string;
  /** Return the key for a belongs-to foreign key. Defaults to `<name>Id`. */
  readonly keyForForeignKey?: (relationshipName: string) => string;
  /** Return the root key for a single model. Defaults to the model name. */
  readonly keyForModel?: (modelName: string) => string;
  /** Return the key for an embedded polymorphic record's type. Defaults to `__type`. */
  readonly keyForPolymorphicType?: (relationshipName: string) => string;
  /** Return the sideload key for records of this model. Defaults to the plural model name. */
  readonly keyForRelationship?: (modelName: string) => string;
  /** Return the key for has-many relationship IDs. Defaults to `<singular name>Ids`. */
  readonly keyForRelationshipIds?: (relationshipName: string) => string;
}

/** A model as seen by a serializer. */
export interface SerializableModel {
  /** The model's persisted attributes. */
  readonly attrs: Record<string, unknown>;
  /** The model ID. */
  readonly id: string;
  /** The model name. */
  readonly modelName: string;
  /** Internal model metadata. */
  readonly [MODEL_METADATA]: {
    readonly relationships: RelationshipRegistry;
  };
}

/** Information about the serialization in progress. */
export interface SerializationContext {
  /** Relationship names included for the current resource. */
  readonly includedRelationships: ReadonlySet<string>;
  /** The request being answered. */
  readonly request: KajoRequest;
}

/**
 * Controls how models and collections become JSON response payloads.
 */
export class Serializer {
  /** Create a serializer of this class with the given options. */
  static extend<Instance extends Serializer>(
    this: new (options?: SerializerOptions) => Instance,
    options: SerializerOptions = {},
  ): Instance {
    return new this(options);
  }

  /** Attributes to serialize, or `undefined` for all. */
  readonly attrs: readonly string[] | undefined;
  /** Whether included relationships are embedded instead of sideloaded. */
  readonly embed: boolean;
  /** Relationships to include in the payload. */
  readonly include: IncludeOption;
  /** Whether the payload is wrapped in a key named after the model. */
  readonly root: boolean;
  /** When relationship IDs are added. */
  readonly serializeIds: SerializeIdsOption;

  readonly #options: SerializerOptions;

  /** Create a serializer with the given options. */
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

  /** Transform an attribute name into a payload key. */
  keyForAttribute(attribute: string): string {
    return this.#options.keyForAttribute?.(attribute) ?? attribute;
  }

  /** Return the root key for a collection of this model. */
  keyForCollection(modelName: string): string {
    return this.#options.keyForCollection?.(modelName) ?? pluralize(this.keyForModel(modelName));
  }

  /** Return the key for an embedded relationship. */
  keyForEmbeddedRelationship(relationshipName: string): string {
    return this.#options.keyForEmbeddedRelationship?.(relationshipName) ?? relationshipName;
  }

  /** Return the key for a belongs-to foreign key. */
  keyForForeignKey(relationshipName: string): string {
    return this.#options.keyForForeignKey?.(relationshipName) ?? `${relationshipName}Id`;
  }

  /** Return the root key for a single model. */
  keyForModel(modelName: string): string {
    return this.#options.keyForModel?.(modelName) ?? modelName;
  }

  /** Return the key for an embedded polymorphic record's type. */
  keyForPolymorphicType(relationshipName: string): string {
    return (
      this.#options.keyForPolymorphicType?.(relationshipName) ?? this.keyForAttribute("__type")
    );
  }

  /** Return the sideload key for records of this model. */
  keyForRelationship(modelName: string): string {
    return this.#options.keyForRelationship?.(modelName) ?? pluralize(modelName);
  }

  /** Return the key for has-many relationship IDs. */
  keyForRelationshipIds(relationshipName: string): string {
    return (
      this.#options.keyForRelationshipIds?.(relationshipName) ??
      `${singularize(relationshipName)}Ids`
    );
  }

  /** Return the relationship names to include for this request and resource. */
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
  /** Create a REST serializer. Relationship IDs default to `"always"`. */
  constructor(options: SerializerOptions = {}) {
    super({ serializeIds: "always", ...options });
  }
}

/** Serializers keyed by model name, with `application` as the fallback. */
export type SerializerRegistry = Record<string, Serializer | undefined> & {
  readonly application?: Serializer;
};

interface Sideload {
  readonly models: Map<string, SerializableModel>;
  readonly root: string;
}

interface PrimaryResource {
  readonly isCollection: boolean;
  readonly isPolymorphic: boolean;
  readonly modelNames: readonly string[];
  readonly models: SerializableModel[];
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
  const primarySerializers = primary.modelNames.map((modelName) =>
    serializerFor(modelName, serializers),
  );
  const rootModes = new Set(primarySerializers.map(({ root }) => root));

  if (primary.isPolymorphic && rootModes.size > 1) {
    throw new TypeError(
      "A polymorphic collection cannot mix rooted and rootless target serializers.",
    );
  }

  const emitted = new Set(primary.models.map((resource) => `${resource.modelName}:${resource.id}`));
  const entries = primary.models.map((resource) => ({
    data: serializeModel(resource, request, serializers, sideloads, visited),
    resource,
  }));

  if (rootModes.has(false)) {
    const data = entries.map(({ data: serialized }) => serialized);
    return primary.isCollection ? data : data[0];
  }

  const payload: Record<string, unknown> = {};

  for (const [index, modelName] of primary.modelNames.entries()) {
    const serializer = primarySerializers[index];
    const data = entries
      .filter(({ resource }) => resource.modelName === modelName)
      .map(({ data: serialized }) => serialized);
    payload[serializer.rootKey(modelName, primary.isCollection)] = primary.isCollection
      ? data
      : data[0];
  }

  drainSideloads(payload, sideloads, emitted, request, serializers, visited);
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
      const embedded = related.map((model) => {
        const serialized = serializeModel(model, request, serializers, sideloads, new Set(visited));
        return relationship.polymorphic === true
          ? withPolymorphicType(serialized, model, name, serializers)
          : serialized;
      });
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

function toPrimaryResource(value: unknown): PrimaryResource | undefined {
  if (value instanceof PolymorphicCollection) {
    return {
      isCollection: true,
      isPolymorphic: true,
      modelNames: value.modelNames,
      models: value.models.filter(isSerializableModel),
    };
  }

  if (value instanceof Collection) {
    return {
      isCollection: true,
      isPolymorphic: false,
      modelNames: [value.modelName],
      models: value.models.filter(isSerializableModel),
    };
  }

  return isSerializableModel(value)
    ? {
        isCollection: false,
        isPolymorphic: false,
        modelNames: [value.modelName],
        models: [value],
      }
    : undefined;
}

function drainSideloads(
  payload: Record<string, unknown>,
  sideloads: Map<string, Sideload>,
  emitted: Set<string>,
  request: KajoRequest,
  serializers: SerializerRegistry,
  visited: Set<string>,
): void {
  while (true) {
    let pending: { resource: SerializableModel; root: string } | undefined;

    for (const sideload of sideloads.values()) {
      const resource = [...sideload.models.values()].find(
        (model) => !emitted.has(`${model.modelName}:${model.id}`),
      );

      if (resource) {
        pending = { resource, root: sideload.root };
        break;
      }
    }

    if (!pending) {
      return;
    }

    const identity = `${pending.resource.modelName}:${pending.resource.id}`;
    emitted.add(identity);
    const serialized = serializeModel(pending.resource, request, serializers, sideloads, visited);
    const existing = payload[pending.root];

    if (Array.isArray(existing)) {
      existing.push(serialized);
    } else if (existing === undefined) {
      payload[pending.root] = [serialized];
    } else {
      payload[pending.root] = [existing, serialized];
    }
  }
}

function withPolymorphicType(
  serialized: Record<string, unknown>,
  model: SerializableModel,
  relationshipName: string,
  serializers: SerializerRegistry,
): Record<string, unknown> {
  const key = serializerFor(model.modelName, serializers).keyForPolymorphicType(relationshipName);

  if (Object.prototype.hasOwnProperty.call(serialized, key)) {
    throw new Error(
      `Cannot serialize polymorphic type for "${relationshipName}" because "${key}" is already in use.`,
    );
  }

  return { ...serialized, [key]: model.modelName };
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
