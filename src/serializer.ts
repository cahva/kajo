import type { KajoRequest } from "./http.ts";
import {
  Collection,
  MODEL_METADATA,
  pluralize,
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

/**
 * Controls how models and collections become JSON response payloads.
 */
export class Serializer {
  static extend(options: SerializerOptions = {}): Serializer {
    return new Serializer(options);
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

  extend(options: SerializerOptions = {}): Serializer {
    return new Serializer({ ...this.#options, ...options });
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
    [primary.isCollection
      ? primarySerializer.keyForCollection(primary.modelName)
      : primarySerializer.keyForModel(primary.modelName)]: primaryData,
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
  const json = serializeAttributes(resource, serializer, relationships);
  const identity = `${resource.modelName}:${resource.id}`;

  if (visited.has(identity)) {
    return json;
  }

  visited.add(identity);

  for (const [name, relationship] of Object.entries(relationships)) {
    const relationshipValue = Reflect.get(resource, name);
    const shouldInclude = included.has(name);

    if (
      !serializer.embed &&
      (serializer.serializeIds === "always" ||
        (serializer.serializeIds === "included" && shouldInclude))
    ) {
      addRelationshipIds(json, serializer, name, relationship, relationshipValue);
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

    const root = serializer.keyForRelationship(relationship.modelName);
    const sideload = sideloads.get(root) ?? {
      models: new Map<string, SerializableModel>(),
      root,
    };

    for (const model of related) {
      sideload.models.set(`${model.modelName}:${model.id}`, model);
    }

    sideloads.set(root, sideload);
  }

  visited.delete(identity);
  return json;
}

function serializeAttributes(
  resource: SerializableModel,
  serializer: Serializer,
  relationships: RelationshipRegistry,
): Record<string, unknown> {
  const relationshipKeys = new Set(
    Object.entries(relationships).map(([name, relationship]) =>
      relationship.kind === "belongsTo" ? `${name}Id` : `${singularize(name)}Ids`,
    ),
  );
  const selectedAttributes = serializer.attrs ? new Set(serializer.attrs) : undefined;

  return Object.fromEntries(
    Object.entries(resource.attrs)
      .filter(
        ([name]) =>
          !relationshipKeys.has(name) && (!selectedAttributes || selectedAttributes.has(name)),
      )
      .map(([name, value]) => [serializer.keyForAttribute(name), value]),
  );
}

function addRelationshipIds(
  json: Record<string, unknown>,
  serializer: Serializer,
  name: string,
  relationship: RelationshipDefinition,
  value: unknown,
): void {
  const models = relationshipModels(value);

  if (relationship.kind === "belongsTo") {
    json[serializer.keyForForeignKey(name)] = models[0]?.id ?? null;
  } else {
    json[serializer.keyForRelationshipIds(name)] = models.map(({ id }) => id);
  }
}

function relationshipModels(value: unknown): SerializableModel[] {
  if (value instanceof Collection) {
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

function singularize(name: string): string {
  if (name.endsWith("ies")) {
    return `${name.slice(0, -3)}y`;
  }

  if (/(?:ses|xes|zes|ches|shes)$/i.test(name)) {
    return name.slice(0, -2);
  }

  return name.endsWith("s") ? name.slice(0, -1) : name;
}

const DEFAULT_SERIALIZER = new Serializer();
