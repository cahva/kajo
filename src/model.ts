import type {
  Database,
  DatabaseCollection,
  DatabaseData,
  InsertableRecord,
  RecordQuery,
  StoredRecord,
  TableRecord,
  UpdateAttributes,
} from "./database.ts";

declare const modelAttributes: unique symbol;
declare const modelRelationships: unique symbol;

export interface RelationshipOptions {
  /**
   * The relationship key on the associated model.
   *
   * Set this to `null` when the relationship has no inverse.
   */
  readonly inverse?: string | null;
}

export interface BelongsToDefinition<Target extends string = string> extends RelationshipOptions {
  readonly kind: "belongsTo";
  readonly modelName: Target;
}

export interface HasManyDefinition<Target extends string = string> extends RelationshipOptions {
  readonly kind: "hasMany";
  readonly modelName: Target;
}

export type RelationshipDefinition = BelongsToDefinition | HasManyDefinition;

export type RelationshipRegistry = Record<string, RelationshipDefinition>;

/**
 * Declare a to-one relationship.
 */
export function belongsTo<Target extends string>(
  modelName: Target,
  options: RelationshipOptions = {},
): BelongsToDefinition<Target> {
  return { kind: "belongsTo", modelName, ...options };
}

/**
 * Declare a to-many relationship.
 */
export function hasMany<Target extends string>(
  modelName: Target,
  options: RelationshipOptions = {},
): HasManyDefinition<Target> {
  return { kind: "hasMany", modelName, ...options };
}

/**
 * Declares the attributes and relationships stored by a model.
 */
export interface ModelDefinition<
  Attributes extends object = object,
  Relationships extends RelationshipRegistry = RelationshipRegistry,
> {
  readonly relationships: Relationships;
  readonly [modelAttributes]?: Attributes;
  readonly [modelRelationships]?: Relationships;

  extend<Additional extends RelationshipRegistry>(
    relationships: Additional,
  ): ModelDefinition<Attributes, Relationships & Additional>;
}

export type ModelRegistry = Record<string, ModelDefinition>;

export type ModelAttributes<Definition extends ModelDefinition> =
  Definition extends ModelDefinition<infer Attributes, RelationshipRegistry> ? Attributes : never;

export type ModelRelationships<Definition extends ModelDefinition> =
  Definition extends ModelDefinition<object, infer Relationships> ? Relationships : never;

export type Pluralize<Name extends string> = Name extends `${string}${"a" | "e" | "i" | "o" | "u"}y`
  ? `${Name}s`
  : Name extends `${infer Stem}y`
    ? `${Stem}ies`
    : Name extends `${string}s` | `${string}x` | `${string}z` | `${string}ch` | `${string}sh`
      ? `${Name}es`
      : `${Name}s`;

export type ModelTables<Models extends ModelRegistry> = {
  [Name in keyof Models as Pluralize<Name & string>]: readonly ModelAttributes<Models[Name]>[];
};

/**
 * Define a model's attribute type.
 */
export function model<Attributes extends object = object>(): ModelDefinition<Attributes, {}> {
  return createModelDefinition<Attributes, {}>({});
}

function createModelDefinition<
  Attributes extends object,
  Relationships extends RelationshipRegistry,
>(relationships: Relationships): ModelDefinition<Attributes, Relationships> {
  return Object.freeze({
    extend<Additional extends RelationshipRegistry>(additional: Additional) {
      return createModelDefinition<Attributes, Relationships & Additional>({
        ...relationships,
        ...additional,
      });
    },
    relationships,
  });
}

type ModelFor<Models extends ModelRegistry, Name extends string> = Name extends keyof Models
  ? Model<ModelAttributes<Models[Name]>, Models, ModelRelationships<Models[Name]>>
  : Model<object, Models>;

type RelationshipValues<
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = {
  [Name in keyof Relationships]: Relationships[Name] extends BelongsToDefinition<infer Target>
    ? ModelFor<Models, Target> | null
    : Relationships[Name] extends HasManyDefinition<infer Target>
      ? CollectionFor<Models, Target>
      : never;
};

type CollectionFor<Models extends ModelRegistry, Name extends string> = Name extends keyof Models
  ? Collection<ModelAttributes<Models[Name]>, Models, ModelRelationships<Models[Name]>>
  : Collection<object, Models>;

type RelationshipInputs<
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = {
  [Name in keyof Relationships]?: Relationships[Name] extends BelongsToDefinition<infer Target>
    ? ModelFor<Models, Target> | null
    : Relationships[Name] extends HasManyDefinition<infer Target>
      ? CollectionFor<Models, Target> | readonly ModelFor<Models, Target>[]
      : never;
};

/**
 * A persisted model instance.
 */
export type Model<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> = ModelInstance<Attributes, Models, Relationships> &
  StoredRecord<Attributes> &
  RelationshipValues<Models, Relationships>;

/**
 * Shared behavior for a persisted model.
 */
export interface ModelInstance<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> {
  readonly attrs: StoredRecord<Attributes>;
  readonly isDestroyed: boolean;
  readonly modelName: string;

  destroy(): void;
  reload(): Model<Attributes, Models, Relationships>;
  save(): Model<Attributes, Models, Relationships>;
  toJSON(): StoredRecord<Attributes>;
  update(attributes: UpdateAttributes<Attributes>): Model<Attributes, Models, Relationships>;
}

/**
 * A result containing zero or more model instances.
 */
export class Collection<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> implements Iterable<Model<Attributes, Models, Relationships>> {
  constructor(
    readonly modelName: string,
    readonly models: Model<Attributes, Models, Relationships>[],
  ) {}

  get length(): number {
    return this.models.length;
  }

  toJSON(): StoredRecord<Attributes>[] {
    return this.models.map((instance) => instance.toJSON());
  }

  [Symbol.iterator](): Iterator<Model<Attributes, Models, Relationships>> {
    return this.models[Symbol.iterator]();
  }
}

type CreateModelAttributes<
  Attributes extends object,
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = InsertableRecord<Attributes> & RelationshipInputs<Models, Relationships>;

/**
 * Creates and queries model instances in one database collection.
 */
export class ModelCollection<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> {
  readonly #collection: DatabaseCollection<Attributes>;
  readonly #models: Models;
  readonly #relationships: Relationships;
  readonly #schema: () => Schema<DatabaseData, Models>;

  constructor(
    readonly modelName: string,
    collection: DatabaseCollection<Attributes>,
    models: Models,
    relationships: Relationships,
    schema: () => Schema<DatabaseData, Models>,
  ) {
    this.#collection = collection;
    this.#models = models;
    this.#relationships = relationships;
    this.#schema = schema;
  }

  all(): Collection<Attributes, Models, Relationships> {
    return this.#wrapMany([...this.#collection]);
  }

  create(
    input: CreateModelAttributes<Attributes, Models, Relationships>,
  ): Model<Attributes, Models, Relationships> {
    const attributes = { ...input } as Record<string, unknown>;
    const relationshipValues = new Map<string, unknown>();

    for (const name of Object.keys(this.#relationships)) {
      if (name in attributes) {
        relationshipValues.set(name, attributes[name]);
        delete attributes[name];
      }
    }

    const instance = this.#wrap(
      this.#collection.insert(attributes as InsertableRecord<Attributes>),
    );

    for (const [name, value] of relationshipValues) {
      Reflect.set(instance, name, value);
    }

    return instance;
  }

  find(id: number | string): Model<Attributes, Models, Relationships> | null;
  find(ids: readonly (number | string)[]): Collection<Attributes, Models, Relationships>;
  find(
    ids: number | string | readonly (number | string)[],
  ):
    | Model<Attributes, Models, Relationships>
    | Collection<Attributes, Models, Relationships>
    | null {
    if (Array.isArray(ids)) {
      return this.#wrapMany(this.#collection.find(ids));
    }

    const record = this.#collection.find(ids as number | string);
    return record ? this.#wrap(record) : null;
  }

  findBy(query: RecordQuery<Attributes>): Model<Attributes, Models, Relationships> | null {
    const record = this.#collection.findBy(query);
    return record ? this.#wrap(record) : null;
  }

  first(): Model<Attributes, Models, Relationships> | null {
    const record = this.#collection[0];
    return record ? this.#wrap(record) : null;
  }

  where(query: RecordQuery<Attributes>): Collection<Attributes, Models, Relationships> {
    return this.#wrapMany(this.#collection.where(query));
  }

  #wrap(record: StoredRecord<Attributes>): Model<Attributes, Models, Relationships> {
    return createModel(
      this.modelName,
      this.#collection,
      record,
      this.#models,
      this.#relationships,
      this.#schema,
    );
  }

  #wrapMany(records: StoredRecord<Attributes>[]): Collection<Attributes, Models, Relationships> {
    return new Collection(
      this.modelName,
      records.map((record) => this.#wrap(record)),
    );
  }
}

type ModelNameForCollection<Models extends ModelRegistry, CollectionName extends string> = {
  [Name in keyof Models]: Pluralize<Name & string> extends CollectionName ? Name : never;
}[keyof Models];

type SchemaCollection<
  Tables extends DatabaseData,
  Models extends ModelRegistry,
  Name extends keyof Tables,
> =
  ModelNameForCollection<Models, Name & string> extends infer ModelName
    ? ModelName extends keyof Models
      ? ModelCollection<
          ModelAttributes<Models[ModelName]>,
          Models,
          ModelRelationships<Models[ModelName]>
        >
      : ModelCollection<TableRecord<Tables[Name]>, Models>
    : never;

export type Schema<
  Tables extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> = {
  readonly db: Database<Tables>;
} & {
  readonly [Name in keyof Tables]: SchemaCollection<Tables, Models, Name>;
};

export function createSchema<Tables extends DatabaseData, Models extends ModelRegistry = {}>(
  db: Database<Tables>,
  models: Models = {} as Models,
): Schema<Tables, Models> {
  validateModels(models);

  const collections = new Map<string, ModelCollection<object, Models>>();
  const schema = { db };
  const modelNames = new Map(
    Object.entries(models).map(([name, definition]) => [pluralize(name), { definition, name }]),
  );
  let proxy: Schema<Tables, Models>;

  proxy = new Proxy(schema, {
    get(target, property) {
      if (typeof property !== "string" || !Object.prototype.hasOwnProperty.call(db, property)) {
        return Reflect.get(target, property);
      }

      let collection = collections.get(property);

      if (!collection) {
        const model = modelNames.get(property);
        collection = new ModelCollection(
          model?.name ?? singularize(property),
          db[property],
          models,
          model?.definition.relationships ?? {},
          () => proxy as Schema<DatabaseData, Models>,
        );
        collections.set(property, collection);
      }

      return collection;
    },
  }) as Schema<Tables, Models>;

  return proxy;
}

export function pluralize(name: string): string {
  if (/[^aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }

  if (/(?:[sxz]|ch|sh)$/i.test(name)) {
    return `${name}es`;
  }

  return `${name}s`;
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

function createModel<
  Attributes extends object,
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
>(
  modelName: string,
  collection: DatabaseCollection<Attributes>,
  initialRecord: StoredRecord<Attributes>,
  models: Models,
  relationships: Relationships,
  schema: () => Schema<DatabaseData, Models>,
): Model<Attributes, Models, Relationships> {
  let record = initialRecord;
  let isDestroyed = false;

  const instance: ModelInstance<Attributes, Models, Relationships> = {
    get attrs() {
      return record;
    },
    get isDestroyed() {
      return isDestroyed;
    },
    modelName,
    destroy() {
      collection.remove(record.id);
      isDestroyed = true;
    },
    reload() {
      const persisted = collection.find(record.id);

      if (!persisted) {
        throw new Error(`Cannot reload destroyed ${modelName}:${record.id}.`);
      }

      record = persisted;
      return proxy;
    },
    save() {
      if (isDestroyed) {
        throw new Error(`Cannot save destroyed ${modelName}:${record.id}.`);
      }

      return proxy;
    },
    toJSON() {
      return { ...record };
    },
    update(attributes) {
      const updated = collection.update(record.id, attributes);

      if (!updated) {
        throw new Error(`Cannot update destroyed ${modelName}:${record.id}.`);
      }

      record = updated;
      return proxy;
    },
  };

  const proxy = new Proxy(instance as Model<Attributes, Models, Relationships>, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }

      if (typeof property === "string" && property in relationships) {
        return getRelationship(
          modelName,
          record,
          property,
          relationships[property],
          models,
          schema(),
        );
      }

      return record[property as keyof StoredRecord<Attributes>];
    },
    set(target, property, value, receiver) {
      if (property in target) {
        return Reflect.set(target, property, value, receiver);
      }

      if (property === "id") {
        throw new TypeError("Model ids cannot be changed.");
      }

      if (typeof property === "string" && property in relationships) {
        setRelationship(
          modelName,
          record,
          property,
          relationships[property],
          value,
          models,
          schema(),
        );
        return true;
      }

      Reflect.set(record, property, value);
      return true;
    },
  });

  return proxy;
}

function getRelationship<Models extends ModelRegistry>(
  sourceModelName: string,
  sourceRecord: StoredRecord<object>,
  relationshipName: string,
  relationship: RelationshipDefinition,
  models: Models,
  schema: Schema<DatabaseData, Models>,
): unknown {
  const targetCollection = schema[pluralize(relationship.modelName)] as unknown as ModelCollection<
    object,
    Models,
    RelationshipRegistry
  >;

  if (relationship.kind === "belongsTo") {
    const id = Reflect.get(sourceRecord, foreignKey(relationshipName));
    return id === undefined || id === null ? null : targetCollection.find(String(id));
  }

  const inverse = findInverse(sourceModelName, relationship, models);

  if (inverse?.definition.kind === "belongsTo") {
    return targetCollection.where({
      [foreignKey(inverse.name)]: sourceRecord.id,
    });
  }

  const ids = Reflect.get(sourceRecord, collectionForeignKey(relationshipName));
  return targetCollection.find(Array.isArray(ids) ? ids.map(String) : []);
}

function setRelationship<Models extends ModelRegistry>(
  sourceModelName: string,
  sourceRecord: StoredRecord<object>,
  relationshipName: string,
  relationship: RelationshipDefinition,
  value: unknown,
  models: Models,
  schema: Schema<DatabaseData, Models>,
): void {
  if (relationship.kind === "belongsTo") {
    const inverse = findInverse(sourceModelName, relationship, models);
    const targetCollection = schema[
      pluralize(relationship.modelName)
    ] as unknown as ModelCollection<object, Models, RelationshipRegistry>;
    const relationshipKey = foreignKey(relationshipName);
    const previousId = Reflect.get(sourceRecord, relationshipKey);

    if (inverse?.definition.kind === "belongsTo" && previousId !== undefined) {
      const previous = targetCollection.find(String(previousId));

      if (previous && Reflect.get(previous.attrs, foreignKey(inverse.name)) === sourceRecord.id) {
        Reflect.deleteProperty(previous.attrs, foreignKey(inverse.name));
      }
    }

    if (value === null || value === undefined) {
      Reflect.deleteProperty(sourceRecord, relationshipKey);
      return;
    }

    const target = asRuntimeModel(value, relationshipName);
    Reflect.set(sourceRecord, relationshipKey, target.id);

    if (inverse?.definition.kind === "belongsTo") {
      Reflect.set(target.attrs, foreignKey(inverse.name), sourceRecord.id);
    }
    return;
  }

  const values: unknown[] =
    value instanceof Collection ? value.models : Array.isArray(value) ? value : [];
  const targets = values.map((target) => asRuntimeModel(target));
  const inverse = findInverse(sourceModelName, relationship, models);
  const targetCollection = schema[pluralize(relationship.modelName)] as unknown as ModelCollection<
    object,
    Models,
    RelationshipRegistry
  >;

  if (inverse?.definition.kind === "belongsTo") {
    const inverseKey = foreignKey(inverse.name);
    const selectedIds = new Set(targets.map(({ id }) => id));

    for (const target of targetCollection.all()) {
      if (
        Reflect.get(target.attrs, inverseKey) === sourceRecord.id &&
        !selectedIds.has(target.id)
      ) {
        Reflect.deleteProperty(target.attrs, inverseKey);
      }
    }

    for (const target of targets) {
      Reflect.set(target.attrs, inverseKey, sourceRecord.id);
    }
    return;
  }

  const relationshipKey = collectionForeignKey(relationshipName);
  const previousIds = new Set(
    Array.isArray(Reflect.get(sourceRecord, relationshipKey))
      ? (Reflect.get(sourceRecord, relationshipKey) as unknown[]).map(String)
      : [],
  );

  Reflect.set(
    sourceRecord,
    relationshipKey,
    targets.map(({ id }) => id),
  );

  if (inverse?.definition.kind === "hasMany") {
    const inverseKey = collectionForeignKey(inverse.name);
    const selectedIds = new Set(targets.map(({ id }) => id));

    for (const target of targetCollection.all()) {
      if (!selectedIds.has(target.id) && !previousIds.has(target.id)) {
        continue;
      }

      const inverseIds = new Set(
        Array.isArray(Reflect.get(target.attrs, inverseKey))
          ? (Reflect.get(target.attrs, inverseKey) as unknown[]).map(String)
          : [],
      );

      if (selectedIds.has(target.id)) {
        inverseIds.add(sourceRecord.id);
      } else {
        inverseIds.delete(sourceRecord.id);
      }

      Reflect.set(target.attrs, inverseKey, [...inverseIds]);
    }
  }
}

function findInverse(
  sourceModelName: string,
  relationship: RelationshipDefinition,
  models: ModelRegistry,
):
  | {
      readonly definition: RelationshipDefinition;
      readonly name: string;
    }
  | undefined {
  if (relationship.inverse === null) {
    return undefined;
  }

  const target = models[relationship.modelName];

  if (!target) {
    return undefined;
  }

  if (relationship.inverse) {
    const definition = target.relationships[relationship.inverse];
    return definition ? { definition, name: relationship.inverse } : undefined;
  }

  const matches = Object.entries(target.relationships).filter(
    ([, candidate]) => candidate.modelName === sourceModelName,
  );

  return matches.length === 1 ? { definition: matches[0][1], name: matches[0][0] } : undefined;
}

function foreignKey(relationshipName: string): string {
  return `${relationshipName}Id`;
}

function collectionForeignKey(relationshipName: string): string {
  return `${singularize(relationshipName)}Ids`;
}

function validateModels(models: ModelRegistry): void {
  for (const [sourceName, definition] of Object.entries(models)) {
    for (const [relationshipName, relationship] of Object.entries(definition.relationships)) {
      const target = models[relationship.modelName];

      if (!target) {
        throw new Error(
          `Relationship "${sourceName}.${relationshipName}" targets unknown model "${relationship.modelName}".`,
        );
      }

      if (typeof relationship.inverse !== "string") {
        continue;
      }

      const inverse = target.relationships[relationship.inverse];

      if (!inverse || inverse.modelName !== sourceName) {
        throw new Error(
          `Relationship "${sourceName}.${relationshipName}" has invalid inverse "${relationship.modelName}.${relationship.inverse}".`,
        );
      }
    }
  }
}

interface RuntimeModel {
  readonly attrs: object;
  readonly id: string;
}

function asRuntimeModel(value: unknown, relationshipName = "hasMany"): RuntimeModel {
  const id = typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined;
  const attrs =
    typeof value === "object" && value !== null ? Reflect.get(value, "attrs") : undefined;

  if (
    typeof value !== "object" ||
    value === null ||
    id === undefined ||
    typeof attrs !== "object" ||
    attrs === null
  ) {
    throw new TypeError(`The "${relationshipName}" relationship expects model instances.`);
  }

  return {
    attrs,
    id: String(id),
  };
}
