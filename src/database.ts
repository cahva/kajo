export type DatabaseData = Record<string, readonly object[]>;

export type StoredRecord<RecordType extends object> = Omit<RecordType, "id"> & {
  id: string;
};

export type InsertableRecord<RecordType extends object> = Omit<RecordType, "id"> & {
  id?: number | string;
};

export type RecordQuery<RecordType extends object> = Partial<StoredRecord<RecordType>>;

type TableRecord<Table extends readonly object[]> = Table[number];

export type DatabaseCollections<Tables extends DatabaseData> = {
  readonly [Name in keyof Tables]: DatabaseCollection<TableRecord<Tables[Name]>>;
};

export type Database<Tables extends DatabaseData = DatabaseData> = DatabaseApi<Tables> &
  DatabaseCollections<Tables>;

export interface DatabaseCollection<RecordType extends object> extends Iterable<
  StoredRecord<RecordType>
> {
  readonly [index: number]: StoredRecord<RecordType>;
  readonly length: number;

  find(id: number | string): StoredRecord<RecordType> | null;
  find(ids: readonly (number | string)[]): StoredRecord<RecordType>[];
  findBy(query: RecordQuery<RecordType>): StoredRecord<RecordType> | null;
  firstOrCreate(
    query: RecordQuery<RecordType>,
    attributesForCreate?: Partial<InsertableRecord<RecordType>>,
  ): StoredRecord<RecordType>;
  insert(record: InsertableRecord<RecordType>): StoredRecord<RecordType>;
  insert(records: readonly InsertableRecord<RecordType>[]): StoredRecord<RecordType>[];
  remove(target?: number | string | RecordQuery<RecordType>): void;
  update(attributes: Partial<StoredRecord<RecordType>>): StoredRecord<RecordType>[];
  update(
    id: number | string,
    attributes: Partial<StoredRecord<RecordType>>,
  ): StoredRecord<RecordType> | null;
  update(
    query: RecordQuery<RecordType>,
    attributes: Partial<StoredRecord<RecordType>>,
  ): StoredRecord<RecordType>[];
  where(query: RecordQuery<RecordType>): StoredRecord<RecordType>[];
}

export interface DatabaseApi<Tables extends DatabaseData> {
  createCollection<Name extends string, RecordType extends object>(
    name: Name,
    initialData?: readonly InsertableRecord<RecordType>[],
  ): DatabaseCollection<RecordType>;
  dump(): {
    [Name in keyof Tables]: StoredRecord<TableRecord<Tables[Name]>>[];
  };
  emptyData(): void;
  loadData(data: Partial<Tables>): void;
}

class IdentityManager {
  readonly #ids = new Set<string>();
  #nextId = 1;

  fetch(id?: number | string): string {
    if (id === undefined) {
      return this.#generate();
    }

    const normalizedId = String(id);

    if (this.#ids.has(normalizedId)) {
      throw new Error(`The id "${normalizedId}" is already in use.`);
    }

    this.#ids.add(normalizedId);
    this.#advancePast(normalizedId);
    return normalizedId;
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
  readonly #identityManager = new IdentityManager();
  readonly #records: StoredRecord<RecordType>[] = [];

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
    target: number | string | RecordQuery<RecordType>,
    attributes?: Partial<StoredRecord<RecordType>>,
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

    return this.#updateMany(this.where(target), attributes);
  }

  where(query: RecordQuery<RecordType>): StoredRecord<RecordType>[] {
    return this.#records.filter((record) => matches(record, query));
  }

  *[Symbol.iterator](): Iterator<StoredRecord<RecordType>> {
    yield* this.#records;
  }

  #insertOne(input: InsertableRecord<RecordType>): StoredRecord<RecordType> {
    const { id: requestedId, ...attributes } = input;
    const record = {
      ...attributes,
      id: this.#identityManager.fetch(requestedId),
    } as StoredRecord<RecordType>;

    this.#records.push(record);
    return record;
  }

  #updateMany(
    records: StoredRecord<RecordType>[],
    attributes: Partial<StoredRecord<RecordType>>,
  ): StoredRecord<RecordType>[] {
    for (const record of records) {
      Object.assign(record, attributes);
    }

    return records;
  }
}

class DatabaseImpl<Tables extends DatabaseData> implements DatabaseApi<Tables> {
  readonly #collections = new Map<string, DatabaseCollectionImpl<object>>();

  createCollection<Name extends string, RecordType extends object>(
    name: Name,
    initialData: readonly InsertableRecord<RecordType>[] = [],
  ): DatabaseCollection<RecordType> {
    const existing = this.#collections.get(name);

    if (existing) {
      existing.insert(initialData);
      return existing as unknown as DatabaseCollection<RecordType>;
    }

    const collection = createCollection<RecordType>();
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

export function createDatabase<Tables extends DatabaseData = DatabaseData>(
  initialData?: Tables,
): Database<Tables> {
  const database = new DatabaseImpl<Tables>();
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

function createCollection<RecordType extends object>(): DatabaseCollection<RecordType> &
  DatabaseCollectionImpl<RecordType> {
  const collection = new DatabaseCollectionImpl<RecordType>();

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
