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

/**
 * Declares the attributes stored by a model.
 */
export interface ModelDefinition<Attributes extends object = object> {
  readonly [modelAttributes]?: Attributes;
}

export type ModelRegistry = Record<string, ModelDefinition>;

export type ModelAttributes<Definition extends ModelDefinition> =
  Definition extends ModelDefinition<infer Attributes> ? Attributes : never;

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
export function model<Attributes extends object = object>(): ModelDefinition<Attributes> {
  return Object.freeze({});
}

/**
 * A persisted model instance.
 */
export type Model<Attributes extends object> = ModelInstance<Attributes> & StoredRecord<Attributes>;

/**
 * Shared behavior for a persisted model.
 */
export interface ModelInstance<Attributes extends object> {
  readonly attrs: StoredRecord<Attributes>;
  readonly isDestroyed: boolean;
  readonly modelName: string;

  destroy(): void;
  reload(): Model<Attributes>;
  save(): Model<Attributes>;
  toJSON(): StoredRecord<Attributes>;
  update(attributes: UpdateAttributes<Attributes>): Model<Attributes>;
}

/**
 * A result containing zero or more model instances.
 */
export class Collection<Attributes extends object> implements Iterable<Model<Attributes>> {
  constructor(
    readonly modelName: string,
    readonly models: Model<Attributes>[],
  ) {}

  get length(): number {
    return this.models.length;
  }

  toJSON(): StoredRecord<Attributes>[] {
    return this.models.map((instance) => instance.toJSON());
  }

  [Symbol.iterator](): Iterator<Model<Attributes>> {
    return this.models[Symbol.iterator]();
  }
}

/**
 * Creates and queries model instances in one database collection.
 */
export class ModelCollection<Attributes extends object> {
  readonly #collection: DatabaseCollection<Attributes>;

  constructor(
    readonly modelName: string,
    collection: DatabaseCollection<Attributes>,
  ) {
    this.#collection = collection;
  }

  all(): Collection<Attributes> {
    return this.#wrapMany([...this.#collection]);
  }

  create(attributes: InsertableRecord<Attributes>): Model<Attributes> {
    return createModel(this.modelName, this.#collection, this.#collection.insert(attributes));
  }

  find(id: number | string): Model<Attributes> | null;
  find(ids: readonly (number | string)[]): Collection<Attributes>;
  find(
    ids: number | string | readonly (number | string)[],
  ): Model<Attributes> | Collection<Attributes> | null {
    if (Array.isArray(ids)) {
      return this.#wrapMany(this.#collection.find(ids));
    }

    const record = this.#collection.find(ids as number | string);
    return record ? createModel(this.modelName, this.#collection, record) : null;
  }

  findBy(query: RecordQuery<Attributes>): Model<Attributes> | null {
    const record = this.#collection.findBy(query);
    return record ? createModel(this.modelName, this.#collection, record) : null;
  }

  first(): Model<Attributes> | null {
    const record = this.#collection[0];
    return record ? createModel(this.modelName, this.#collection, record) : null;
  }

  where(query: RecordQuery<Attributes>): Collection<Attributes> {
    return this.#wrapMany(this.#collection.where(query));
  }

  #wrapMany(records: StoredRecord<Attributes>[]): Collection<Attributes> {
    return new Collection(
      this.modelName,
      records.map((record) => createModel(this.modelName, this.#collection, record)),
    );
  }
}

export type Schema<Tables extends DatabaseData = DatabaseData> = {
  readonly db: Database<Tables>;
} & {
  readonly [Name in keyof Tables]: ModelCollection<TableRecord<Tables[Name]>>;
};

export function createSchema<Tables extends DatabaseData>(
  db: Database<Tables>,
  modelNames: Readonly<Record<string, string>> = {},
): Schema<Tables> {
  const collections = new Map<string, ModelCollection<object>>();
  const schema = { db };

  return new Proxy(schema, {
    get(target, property) {
      if (typeof property !== "string" || !Object.prototype.hasOwnProperty.call(db, property)) {
        return Reflect.get(target, property);
      }

      let collection = collections.get(property);

      if (!collection) {
        collection = new ModelCollection(
          modelNames[property] ?? singularize(property),
          db[property],
        );
        collections.set(property, collection);
      }

      return collection;
    },
  }) as Schema<Tables>;
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

function createModel<Attributes extends object>(
  modelName: string,
  collection: DatabaseCollection<Attributes>,
  initialRecord: StoredRecord<Attributes>,
): Model<Attributes> {
  let record = initialRecord;
  let isDestroyed = false;

  const instance: ModelInstance<Attributes> = {
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

  const proxy = new Proxy(instance as Model<Attributes>, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver);
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

      Reflect.set(record, property, value);
      return true;
    },
  });

  return proxy;
}
