/** Initial records for a database, keyed by collection name. */
export type DatabaseData = Record<string, readonly object[]>;

/** Generates and tracks the IDs of one collection. */
export interface IdentityManagerContract {
  /** Return and reserve an unused identifier. */
  fetch(): number | string;
  /** Reserve an explicitly supplied identifier, throwing when it is already used. */
  set(id: number | string): void;
  /** Mark every identifier as unused. */
  reset(): void;
}

/** A class that creates an identity manager for a collection. */
export type IdentityManagerConstructor = new () => IdentityManagerContract;

/** Options for {@linkcode createDatabase}. */
export interface DatabaseOptions {
  /**
   * Identity manager constructors keyed by collection name.
   *
   * `application` is the fallback for collections without an explicit manager.
   */
  readonly identityManagers?: Readonly<
    Record<string, IdentityManagerConstructor | undefined> & {
      readonly application?: IdentityManagerConstructor;
    }
  >;
}

/** A record as stored in a collection, with its ID normalized to a string. */
export type StoredRecord<RecordType extends object> = Omit<RecordType, "id"> & {
  id: string;
};

/** A record accepted by `insert`. The ID is optional and generated when omitted. */
export type InsertableRecord<RecordType extends object> = Omit<RecordType, "id"> & {
  id?: number | string;
};

/** Attributes a record must equal to match a query. */
export type RecordQuery<RecordType extends object> = Partial<StoredRecord<RecordType>>;

/** Attributes to change in an update. The ID cannot be updated. */
export type UpdateAttributes<RecordType extends object> = Partial<
  Omit<StoredRecord<RecordType>, "id">
>;

/** The record type stored in a table. */
export type TableRecord<Table extends readonly object[]> = Table[number];

/** The collections of a database, keyed by name. */
export type DatabaseCollections<Tables extends DatabaseData> = {
  readonly [Name in keyof Tables]: DatabaseCollection<TableRecord<Tables[Name]>>;
};

/** An in-memory database with typed collections as properties. */
export type Database<Tables extends DatabaseData = DatabaseData> = DatabaseApi<Tables> &
  DatabaseCollections<Tables>;

/** A collection of records, iterable and indexable in insertion order. */
export interface DatabaseCollection<RecordType extends object> extends Iterable<
  StoredRecord<RecordType>
> {
  /** The record at this position. */
  readonly [index: number]: StoredRecord<RecordType>;
  /** The number of records. */
  readonly length: number;

  /** Find a record by ID, or `null` when none matches. */
  find(id: number | string): StoredRecord<RecordType> | null;
  /** Find the records with these IDs. */
  find(ids: readonly (number | string)[]): StoredRecord<RecordType>[];
  /** Find the first record matching the query, or `null`. */
  findBy(query: RecordQuery<RecordType>): StoredRecord<RecordType> | null;
  /**
   * Find the first record matching the query, or insert one from the query and
   * extra attributes.
   */
  firstOrCreate(
    query: RecordQuery<RecordType>,
    attributesForCreate?: Partial<InsertableRecord<RecordType>>,
  ): StoredRecord<RecordType>;
  /** Insert a record, generating an ID when it has none. */
  insert(record: InsertableRecord<RecordType>): StoredRecord<RecordType>;
  /** Insert several records. */
  insert(records: readonly InsertableRecord<RecordType>[]): StoredRecord<RecordType>[];
  /**
   * Remove the record with this ID, the records matching a query, or every
   * record when called without a target.
   */
  remove(target?: number | string | RecordQuery<RecordType>): void;
  /** Update every record. */
  update(attributes: UpdateAttributes<RecordType>): StoredRecord<RecordType>[];
  /** Update the record with this ID, returning `null` when it does not exist. */
  update(
    id: number | string,
    attributes: UpdateAttributes<RecordType>,
  ): StoredRecord<RecordType> | null;
  /** Update the records matching a query. */
  update(
    query: RecordQuery<RecordType>,
    attributes: UpdateAttributes<RecordType>,
  ): StoredRecord<RecordType>[];
  /** Return every record matching the query. */
  where(query: RecordQuery<RecordType>): StoredRecord<RecordType>[];
}

/** Methods available on every database. */
export interface DatabaseApi<Tables extends DatabaseData> {
  /** Create a collection, or insert the records into it when it already exists. */
  createCollection<Name extends string, RecordType extends object>(
    name: Name,
    initialData?: readonly InsertableRecord<RecordType>[],
  ): DatabaseCollection<RecordType>;
  /** Return a copy of every record, keyed by collection name. */
  dump(): {
    [Name in keyof Tables]: StoredRecord<TableRecord<Tables[Name]>>[];
  };
  /** Remove every record and reset ID generation, keeping the collections. */
  emptyData(): void;
  /** Insert records into collections, creating collections as needed. */
  loadData(data: Partial<Tables>): void;
}

/**
 * The default identity manager. It generates sequential string IDs starting at
 * `"1"` and skips IDs that were set explicitly.
 */
export class IdentityManager implements IdentityManagerContract {
  readonly #ids = new Set<string>();
  #nextId = 1;

  fetch(): string {
    return this.#generate();
  }

  set(id: number | string): void {
    const normalizedId = String(id);

    if (this.#ids.has(normalizedId)) {
      throw new Error(`The id "${normalizedId}" is already in use.`);
    }

    this.#ids.add(normalizedId);
    this.#advancePast(normalizedId);
  }

  reset(): void {
    this.#ids.clear();
    this.#nextId = 1;
  }

  #generate(): string {
    while (this.#ids.has(String(this.#nextId))) {
      this.#nextId += 1;
    }

    const id = String(this.#nextId);
    this.#ids.add(id);
    this.#nextId += 1;
    return id;
  }

  #advancePast(id: string): void {
    if (/^\d+$/.test(id)) {
      this.#nextId = Math.max(this.#nextId, Number(id) + 1);
    }
  }
}

class DatabaseCollectionImpl<RecordType extends object> {
  readonly #identityManager: IdentityManagerContract;
  readonly #records: StoredRecord<RecordType>[] = [];

  constructor(identityManager: IdentityManagerContract) {
    this.#identityManager = identityManager;
  }

  get length(): number {
    return this.#records.length;
  }

  at(index: number): StoredRecord<RecordType> | undefined {
    return this.#records[index];
  }

  find(
    ids: number | string | readonly (number | string)[],
  ): StoredRecord<RecordType> | StoredRecord<RecordType>[] | null {
    if (Array.isArray(ids)) {
      return ids.flatMap((id) => {
        const record = this.#records.find((candidate) => candidate.id === String(id));
        return record ? [record] : [];
      });
    }

    const id = String(ids);
    return this.#records.find((record) => record.id === id) ?? null;
  }

  findBy(query: RecordQuery<RecordType>): StoredRecord<RecordType> | null {
    return this.#records.find((record) => matches(record, query)) ?? null;
  }

  firstOrCreate(
    query: RecordQuery<RecordType>,
    attributesForCreate: Partial<InsertableRecord<RecordType>> = {},
  ): StoredRecord<RecordType> {
    return (
      this.findBy(query) ??
      this.#insertOne({
        ...query,
        ...attributesForCreate,
      } as InsertableRecord<RecordType>)
    );
  }

  insert(
    data: InsertableRecord<RecordType> | readonly InsertableRecord<RecordType>[],
  ): StoredRecord<RecordType> | StoredRecord<RecordType>[] {
    if (Array.isArray(data)) {
      return data.map((record) => this.#insertOne(record));
    }

    return this.#insertOne(data as InsertableRecord<RecordType>);
  }

  remove(target?: number | string | RecordQuery<RecordType>): void {
    if (target === undefined) {
      this.#records.length = 0;
      return;
    }

    const shouldRemove =
      typeof target === "object"
        ? (record: StoredRecord<RecordType>) => matches(record, target)
        : (record: StoredRecord<RecordType>) => record.id === String(target);

    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];

      if (shouldRemove(record)) {
        this.#records.splice(index, 1);
      }
    }
  }

  reset(): void {
    this.#records.length = 0;
    this.#identityManager.reset();
  }

  toArray(): StoredRecord<RecordType>[] {
    return [...this.#records];
  }

  update(
    target: number | string | RecordQuery<RecordType> | UpdateAttributes<RecordType>,
    attributes?: UpdateAttributes<RecordType>,
  ): StoredRecord<RecordType> | StoredRecord<RecordType>[] | null {
    if (attributes === undefined) {
      if (typeof target !== "object") {
        throw new TypeError("Updating by id requires attributes.");
      }

      return this.#updateMany(this.#records, target);
    }

    if (typeof target === "number" || typeof target === "string") {
      const record = this.find(target);
      return record ? Object.assign(record, attributes) : null;
    }

    return this.#updateMany(this.where(target as RecordQuery<RecordType>), attributes);
  }

  where(query: RecordQuery<RecordType>): StoredRecord<RecordType>[] {
    return this.#records.filter((record) => matches(record, query));
  }

  *[Symbol.iterator](): Iterator<StoredRecord<RecordType>> {
    yield* this.#records;
  }

  #insertOne(input: InsertableRecord<RecordType>): StoredRecord<RecordType> {
    const { id: requestedId, ...attributes } = input;
    const id =
      requestedId === undefined ? String(this.#identityManager.fetch()) : String(requestedId);

    if (this.#records.some((record) => record.id === id)) {
      throw new Error(`The id "${id}" is already in use.`);
    }

    if (requestedId !== undefined) {
      this.#identityManager.set(id);
    }

    const record = {
      ...attributes,
      id,
    } as StoredRecord<RecordType>;

    this.#records.push(record);
    return record;
  }

  #updateMany(
    records: StoredRecord<RecordType>[],
    attributes: UpdateAttributes<RecordType>,
  ): StoredRecord<RecordType>[] {
    for (const record of records) {
      Object.assign(record, attributes);
    }

    return records;
  }
}

class DatabaseImpl<Tables extends DatabaseData> implements DatabaseApi<Tables> {
  readonly #collections = new Map<string, DatabaseCollectionImpl<object>>();
  readonly #options: DatabaseOptions;

  constructor(options: DatabaseOptions) {
    this.#options = options;
  }

  createCollection<Name extends string, RecordType extends object>(
    name: Name,
    initialData: readonly InsertableRecord<RecordType>[] = [],
  ): DatabaseCollection<RecordType> {
    const existing = this.#collections.get(name);

    if (existing) {
      existing.insert(initialData);
      return existing as unknown as DatabaseCollection<RecordType>;
    }

    const Manager =
      this.#options.identityManagers?.[name] ??
      this.#options.identityManagers?.application ??
      IdentityManager;
    const collection = createCollection<RecordType>(new Manager());
    collection.insert(initialData);
    this.#collections.set(name, collection as unknown as DatabaseCollectionImpl<object>);
    return collection;
  }

  dump(): {
    [Name in keyof Tables]: StoredRecord<TableRecord<Tables[Name]>>[];
  } {
    return Object.fromEntries(
      [...this.#collections].map(([name, collection]) => [
        name,
        collection.toArray().map((record) => ({ ...record })),
      ]),
    ) as {
      [Name in keyof Tables]: StoredRecord<TableRecord<Tables[Name]>>[];
    };
  }

  emptyData(): void {
    for (const collection of this.#collections.values()) {
      collection.reset();
    }
  }

  loadData(data: Partial<Tables>): void {
    for (const [name, records] of Object.entries(data)) {
      this.createCollection(name, records);
    }
  }

  getCollection(name: string): DatabaseCollectionImpl<object> | undefined {
    return this.#collections.get(name);
  }

  get collectionNames(): string[] {
    return [...this.#collections.keys()];
  }
}

/** Create an in-memory database, optionally seeded with records. */
export function createDatabase<Tables extends DatabaseData = DatabaseData>(
  initialData?: Tables,
  options: DatabaseOptions = {},
): Database<Tables> {
  const database = new DatabaseImpl<Tables>(options);
  const proxy = new Proxy(database, {
    get(target, property) {
      if (typeof property === "string") {
        const collection = target.getCollection(property);

        if (collection) {
          return collection;
        }
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    getOwnPropertyDescriptor(target, property) {
      if (typeof property === "string" && target.getCollection(property)) {
        return { configurable: true, enumerable: true };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    ownKeys(target) {
      return [...Reflect.ownKeys(target), ...target.collectionNames];
    },
  }) as Database<Tables>;

  if (initialData) {
    proxy.loadData(initialData);
  }

  return proxy;
}

function createCollection<RecordType extends object>(
  identityManager: IdentityManagerContract,
): DatabaseCollection<RecordType> & DatabaseCollectionImpl<RecordType> {
  const collection = new DatabaseCollectionImpl<RecordType>(identityManager);

  return new Proxy(collection, {
    get(target, property) {
      if (typeof property === "string" && /^\d+$/.test(property)) {
        return target.at(Number(property));
      }

      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DatabaseCollection<RecordType> & DatabaseCollectionImpl<RecordType>;
}

function matches<RecordType extends object>(
  record: StoredRecord<RecordType>,
  query: RecordQuery<RecordType>,
): boolean {
  return Object.entries(query).every(
    ([key, value]) => String(record[key as keyof StoredRecord<RecordType>]) === String(value),
  );
}
