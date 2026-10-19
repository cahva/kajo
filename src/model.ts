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
import type { InferSchemaOutput, KajoSchema } from "./standard-schema.ts";

declare const modelAttributes: unique symbol;
declare const modelRelationships: unique symbol;
export const MODEL_METADATA: unique symbol = Symbol("kajo.model");
const MODEL_AFTER_SAVE: unique symbol = Symbol("kajo.model.afterSave");

/** Options shared by every relationship declaration. */
export interface RelationshipOptions {
  /**
   * The relationship key on the associated model.
   *
   * Set this to `null` when the relationship has no inverse.
   */
  readonly inverse?: string | null;
}

/** A to-one relationship to a single model, declared with `belongsTo("name")`. */
export interface BelongsToDefinition<Target extends string = string> extends RelationshipOptions {
  /** Identifies this as a to-one relationship. */
  readonly kind: "belongsTo";
  /** The name of the related model. */
  readonly modelName: Target;
  /** Always `false` or absent for a single-target relationship. */
  readonly polymorphic?: false;
}

/** A to-one relationship whose target can be any of several models, declared with `belongsTo(["a", "b"])`. */
export interface PolymorphicBelongsToDefinition<
  Targets extends readonly string[] = readonly string[],
> extends RelationshipOptions {
  /** Identifies this as a to-one relationship. */
  readonly kind: "belongsTo";
  /** The models the relationship can point to. */
  readonly modelNames: Targets;
  /** Marks the relationship as polymorphic. */
  readonly polymorphic: true;
}

/** A to-many relationship to a single model, declared with `hasMany("name")`. */
export interface HasManyDefinition<Target extends string = string> extends RelationshipOptions {
  /** Identifies this as a to-many relationship. */
  readonly kind: "hasMany";
  /** The name of the related model. */
  readonly modelName: Target;
  /** Always `false` or absent for a single-target relationship. */
  readonly polymorphic?: false;
}

/** A to-many relationship whose members can be any of several models, declared with `hasMany(["a", "b"])`. */
export interface PolymorphicHasManyDefinition<
  Targets extends readonly string[] = readonly string[],
> extends RelationshipOptions {
  /** Identifies this as a to-many relationship. */
  readonly kind: "hasMany";
  /** The models the relationship can contain. */
  readonly modelNames: Targets;
  /** Marks the relationship as polymorphic. */
  readonly polymorphic: true;
}

/** Any relationship declaration accepted by a model definition. */
export type RelationshipDefinition =
  | BelongsToDefinition
  | HasManyDefinition
  | PolymorphicBelongsToDefinition
  | PolymorphicHasManyDefinition;

/** Relationship declarations keyed by relationship name. */
export type RelationshipRegistry = Record<string, RelationshipDefinition>;

/**
 * Declare a to-one relationship.
 */
export function belongsTo<Target extends string>(
  modelName: Target,
  options?: RelationshipOptions,
): BelongsToDefinition<Target>;
/** Declare a polymorphic to-one relationship that can point to any of the listed models. */
export function belongsTo<const Targets extends readonly [string, ...string[]]>(
  modelNames: Targets,
  options?: RelationshipOptions,
): PolymorphicBelongsToDefinition<Targets>;
export function belongsTo(
  target: string | readonly [string, ...string[]],
  options: RelationshipOptions = {},
): BelongsToDefinition | PolymorphicBelongsToDefinition {
  const relationshipOptions: RelationshipOptions =
    options.inverse === undefined ? {} : { inverse: options.inverse };
  return Array.isArray(target)
    ? { ...relationshipOptions, kind: "belongsTo", modelNames: target, polymorphic: true }
    : { ...relationshipOptions, kind: "belongsTo", modelName: target as string };
}

/**
 * Declare a to-many relationship.
 */
export function hasMany<Target extends string>(
  modelName: Target,
  options?: RelationshipOptions,
): HasManyDefinition<Target>;
/** Declare a polymorphic to-many relationship that can contain any of the listed models. */
export function hasMany<const Targets extends readonly [string, ...string[]]>(
  modelNames: Targets,
  options?: RelationshipOptions,
): PolymorphicHasManyDefinition<Targets>;
export function hasMany(
  target: string | readonly [string, ...string[]],
  options: RelationshipOptions = {},
): HasManyDefinition | PolymorphicHasManyDefinition {
  const relationshipOptions: RelationshipOptions =
    options.inverse === undefined ? {} : { inverse: options.inverse };
  return Array.isArray(target)
    ? { ...relationshipOptions, kind: "hasMany", modelNames: target, polymorphic: true }
    : { ...relationshipOptions, kind: "hasMany", modelName: target as string };
}

/**
 * Declares the attributes and relationships stored by a model.
 */
export interface ModelDefinition<
  Attributes extends object = object,
  Relationships extends RelationshipRegistry = RelationshipRegistry,
  AttributeSchema extends KajoSchema<unknown, Attributes> | undefined =
    | KajoSchema<unknown, Attributes>
    | undefined,
> {
  /** Relationship declarations added with `extend()`. */
  readonly relationships: Relationships;
  /** The Standard Schema the attribute type is inferred from, or `undefined` for a type-only model. */
  readonly schema: AttributeSchema;
  /** Type-only marker carrying the attribute type. Never set at runtime. */
  readonly [modelAttributes]?: Attributes;
  /** Type-only marker carrying the relationship types. Never set at runtime. */
  readonly [modelRelationships]?: Relationships;

  /** Return a new definition with additional relationships. The original definition is unchanged. */
  extend<Additional extends RelationshipRegistry>(
    relationships: Additional,
  ): ModelDefinition<Attributes, Relationships & Additional, AttributeSchema>;
}

/** Model definitions keyed by singular model name. */
export type ModelRegistry = Record<string, ModelDefinition>;

/** The attribute type declared by a model definition. */
export type ModelAttributes<Definition extends ModelDefinition> =
  Definition extends ModelDefinition<infer Attributes, RelationshipRegistry> ? Attributes : never;

export type ModelRelationships<Definition extends ModelDefinition> =
  Definition extends ModelDefinition<object, infer Relationships> ? Relationships : never;

/** The collection name Kajo derives from a singular model name, such as `post` to `posts` or `category` to `categories`. */
export type Pluralize<Name extends string> = Name extends `${string}${"a" | "e" | "i" | "o" | "u"}y`
  ? `${Name}s`
  : Name extends `${infer Stem}y`
    ? `${Stem}ies`
    : Name extends `${string}s` | `${string}x` | `${string}z` | `${string}ch` | `${string}sh`
      ? `${Name}es`
      : `${Name}s`;

/** The model name Kajo derives from a plural collection name, the inverse of `Pluralize`. */
export type Singularize<Name extends string> = Name extends `${infer Stem}ies`
  ? `${Stem}y`
  : Name extends `${infer Stem}ches`
    ? `${Stem}ch`
    : Name extends `${infer Stem}shes`
      ? `${Stem}sh`
      : Name extends `${infer Stem}ses`
        ? `${Stem}s`
        : Name extends `${infer Stem}xes`
          ? `${Stem}x`
          : Name extends `${infer Stem}zes`
            ? `${Stem}z`
            : Name extends `${infer Stem}s`
              ? Stem
              : Name;

/** Database table types derived from a model registry, keyed by pluralized model name. */
export type ModelTables<Models extends ModelRegistry> = {
  [Name in keyof Models as Pluralize<Name & string>]: readonly ModelAttributes<Models[Name]>[];
};

/**
 * Define a model's attribute type.
 */
export function model<Attributes extends object = object>(): ModelDefinition<
  Attributes,
  {},
  undefined
>;
/**
 * Define a model whose attribute type is inferred from a Standard Schema. The
 * schema is kept on the definition; Kajo does not validate stored attributes
 * against it.
 */
export function model<AttributeSchema extends KajoSchema<unknown, object>>(
  schema: AttributeSchema,
): ModelDefinition<InferSchemaOutput<AttributeSchema>, {}, AttributeSchema>;
export function model(
  schema?: KajoSchema<unknown, object>,
): ModelDefinition<object, {}, KajoSchema<unknown, object> | undefined> {
  return createModelDefinition<object, {}, KajoSchema<unknown, object> | undefined>({}, schema);
}

function createModelDefinition<
  Attributes extends object,
  Relationships extends RelationshipRegistry,
  AttributeSchema extends KajoSchema<unknown, Attributes> | undefined,
>(
  relationships: Relationships,
  schema: AttributeSchema,
): ModelDefinition<Attributes, Relationships, AttributeSchema> {
  return Object.freeze({
    extend<Additional extends RelationshipRegistry>(additional: Additional) {
      return createModelDefinition<Attributes, Relationships & Additional, AttributeSchema>(
        {
          ...relationships,
          ...additional,
        },
        schema,
      );
    },
    relationships,
    schema,
  });
}

/** The persisted model type for a model name in a registry. */
export type ModelFor<Models extends ModelRegistry, Name extends string> = Name extends keyof Models
  ? Model<ModelAttributes<Models[Name]>, Models, ModelRelationships<Models[Name]>>
  : Model<object, Models>;

/** Identifies the target of a polymorphic relationship by model type and ID. */
export interface PolymorphicIdentifier<Type extends string = string> {
  /** The related record's ID. */
  readonly id: string;
  /** The related model's name. */
  readonly type: Type;
}

type RelationshipModelName<Relationship extends RelationshipDefinition> = Relationship extends
  | PolymorphicBelongsToDefinition<infer Targets>
  | PolymorphicHasManyDefinition<infer Targets>
  ? Targets[number]
  : Relationship extends BelongsToDefinition<infer Target>
    ? Target
    : Relationship extends HasManyDefinition<infer Target>
      ? Target
      : never;

/** The unsaved model type for a model name in a registry. */
export type NewModelFor<
  Models extends ModelRegistry,
  Name extends string,
> = Name extends keyof Models
  ? NewModel<ModelAttributes<Models[Name]>, Models, ModelRelationships<Models[Name]>>
  : NewModel<object, Models>;

type RelationshipValues<
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = {
  [Name in keyof Relationships]: Relationships[Name] extends
    | BelongsToDefinition
    | PolymorphicBelongsToDefinition
    ? ModelFor<Models, RelationshipModelName<Relationships[Name]>> | null
    : Relationships[Name] extends PolymorphicHasManyDefinition<infer Targets>
      ? PolymorphicCollection<Models, Targets>
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
  [Name in keyof Relationships]?: Relationships[Name] extends
    | BelongsToDefinition
    | PolymorphicBelongsToDefinition
    ? ModelFor<Models, RelationshipModelName<Relationships[Name]>> | null
    : Relationships[Name] extends PolymorphicHasManyDefinition<infer Targets>
      ? PolymorphicCollection<Models, Targets> | readonly ModelFor<Models, Targets[number]>[]
      : Relationships[Name] extends HasManyDefinition<infer Target>
        ? CollectionFor<Models, Target> | readonly ModelFor<Models, Target>[]
        : never;
};

type RelatedModelInput<
  Models extends ModelRegistry,
  Name extends string,
> = Name extends keyof Models ? Omit<ModelCreateInput<Models, Name>, "id"> : object;

type RelationshipIds<Relationships extends RelationshipRegistry> = {
  [
    Name in keyof Relationships as Name extends string
      ? Relationships[Name] extends BelongsToDefinition
        ? `${Name}Id`
        : Relationships[Name] extends PolymorphicBelongsToDefinition
          ? `${Name}Id`
          : Relationships[Name] extends HasManyDefinition | PolymorphicHasManyDefinition
            ? `${Singularize<Name>}Ids`
            : never
      : never
  ]: Relationships[Name] extends PolymorphicBelongsToDefinition
    ? PolymorphicIdentifier<RelationshipModelName<Relationships[Name]>> | null
    : Relationships[Name] extends BelongsToDefinition
      ? string | null
      : Relationships[Name] extends PolymorphicHasManyDefinition
        ? readonly PolymorphicIdentifier<RelationshipModelName<Relationships[Name]>>[]
        : readonly string[];
};

type RelationshipNewHelpers<
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = {
  [
    Name in keyof Relationships as Name extends string
      ? Relationships[Name] extends BelongsToDefinition | PolymorphicBelongsToDefinition
        ? `new${Capitalize<Name>}`
        : Relationships[Name] extends HasManyDefinition | PolymorphicHasManyDefinition
          ? `new${Capitalize<Singularize<Name>>}`
          : never
      : never
  ]: Relationships[Name] extends
    | PolymorphicBelongsToDefinition<infer Targets>
    | PolymorphicHasManyDefinition<infer Targets>
    ? <Target extends Targets[number]>(
        modelName: Target,
        attributes: RelatedModelInput<Models, Target>,
      ) => NewModelFor<Models, Target>
    : Relationships[Name] extends RelationshipDefinition
      ? (
          attributes: RelatedModelInput<Models, RelationshipModelName<Relationships[Name]>>,
        ) => NewModelFor<Models, RelationshipModelName<Relationships[Name]>>
      : never;
};

type RelationshipCreateHelpers<
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = {
  [
    Name in keyof Relationships as Name extends string
      ? Relationships[Name] extends BelongsToDefinition | PolymorphicBelongsToDefinition
        ? `create${Capitalize<Name>}`
        : Relationships[Name] extends HasManyDefinition | PolymorphicHasManyDefinition
          ? `create${Capitalize<Singularize<Name>>}`
          : never
      : never
  ]: Relationships[Name] extends
    | PolymorphicBelongsToDefinition<infer Targets>
    | PolymorphicHasManyDefinition<infer Targets>
    ? <Target extends Targets[number]>(
        modelName: Target,
        attributes: RelatedModelInput<Models, Target>,
      ) => ModelFor<Models, Target>
    : Relationships[Name] extends RelationshipDefinition
      ? (
          attributes: RelatedModelInput<Models, RelationshipModelName<Relationships[Name]>>,
        ) => ModelFor<Models, RelationshipModelName<Relationships[Name]>>
      : never;
};

type RelationshipConveniences<
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = RelationshipIds<Relationships> &
  RelationshipNewHelpers<Models, Relationships> &
  RelationshipCreateHelpers<Models, Relationships>;

/**
 * A persisted model instance.
 */
export type Model<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> = ModelInstance<Attributes, Models, Relationships> &
  StoredRecord<Attributes> &
  RelationshipValues<Models, Relationships> &
  RelationshipConveniences<Models, Relationships>;

/** The attributes of an unsaved model, whose `id` is `null` until it is saved. */
export type NewModelRecord<Attributes extends object> = Omit<Attributes, "id"> & {
  readonly id: null;
};

/**
 * A model instance that has not been persisted yet.
 */
export type NewModel<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> = NewModelInstance<Attributes, Models, Relationships> &
  NewModelRecord<Attributes> &
  RelationshipValues<Models, Relationships> &
  RelationshipConveniences<Models, Relationships>;

/**
 * Shared behavior for a persisted model.
 */
export interface ModelInstance<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> {
  /** A snapshot of the stored attributes. */
  readonly attrs: StoredRecord<Attributes>;
  /** Whether `destroy()` has removed this model from the database. */
  readonly isDestroyed: boolean;
  /** The singular name of this model. */
  readonly modelName: string;
  /** Internal relationship metadata used by serializers and collections. */
  readonly [MODEL_METADATA]: {
    readonly relationships: Relationships;
  };

  /** Remove the model from the database and clean up its relationships. */
  destroy(): void;
  /** Whether the record is missing from the database, such as after `destroy()`. */
  isNew(): boolean;
  /** Whether the record is currently stored in the database. */
  isSaved(): boolean;
  /** Refresh the attributes from the database. Throws if the model was destroyed. */
  reload(): Model<Attributes, Models, Relationships>;
  /** Return this model. Persisted models are saved on every change. Throws if the model was destroyed. */
  save(): Model<Attributes, Models, Relationships>;
  /** A plain copy of the stored attributes. */
  toJSON(): StoredRecord<Attributes>;
  /** Update attributes in the database and return this model. Throws if the model was destroyed. */
  update(attributes: UpdateAttributes<Attributes>): Model<Attributes, Models, Relationships>;
}

/**
 * Shared behavior for an unsaved model.
 */
export interface NewModelInstance<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> {
  /** The unsaved attributes, with `id` set to `null`. */
  readonly attrs: NewModelRecord<Attributes>;
  /** Whether the model was saved and then destroyed. */
  readonly isDestroyed: boolean;
  /** The singular name of this model. */
  readonly modelName: string;
  /** Internal relationship metadata used by serializers and collections. */
  readonly [MODEL_METADATA]: {
    readonly relationships: Relationships;
  };

  /** Remove the model from the database if it was saved. Does nothing before the first save. */
  destroy(): void;
  /** Whether the model has not been saved yet, or was destroyed. */
  isNew(): boolean;
  /** Whether the model has been saved and not destroyed. */
  isSaved(): boolean;
  /** Refresh the attributes from the database after a save. Before the first save, returns the model unchanged. */
  reload(): NewModel<Attributes, Models, Relationships>;
  /** Insert the model and apply its pending relationships, then return the persisted model. */
  save(): Model<Attributes, Models, Relationships>;
  /** A plain copy of the attributes. */
  toJSON(): NewModelRecord<Attributes>;
  /** Assign attributes and save the model. */
  update(attributes: UpdateAttributes<Attributes>): Model<Attributes, Models, Relationships>;
}

type PolymorphicModelFor<
  Models extends ModelRegistry,
  Targets extends readonly string[],
> = ModelFor<Models, Targets[number]>;

type PolymorphicUpdateAttributes<
  Models extends ModelRegistry,
  Targets extends readonly string[],
> = {
  [Key in keyof PolymorphicTargetUpdates<Models, Targets>]?: IntersectTargetProperty<
    Models,
    Targets,
    Key
  >;
};

type PolymorphicTargetUpdates<
  Models extends ModelRegistry,
  Targets extends readonly string[],
> = Targets[number] extends infer Name
  ? Name extends keyof Models
    ? UpdateAttributes<ModelAttributes<Models[Name]>>
    : never
  : never;

type IntersectTargetProperty<
  Models extends ModelRegistry,
  Targets extends readonly string[],
  Key extends keyof PolymorphicTargetUpdates<Models, Targets>,
> = (
  Targets[number] extends infer Name
    ? Name extends keyof Models
      ? Key extends keyof UpdateAttributes<ModelAttributes<Models[Name]>>
        ? (value: UpdateAttributes<ModelAttributes<Models[Name]>>[Key]) => void
        : never
      : never
    : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

interface CollectionMember<Serialized extends object> {
  readonly id: string;
  readonly modelName: string;
  destroy(): void;
  reload(): unknown;
  save(): unknown;
  toJSON(): Serialized;
}

abstract class CollectionBase<
  Member extends CollectionMember<Serialized>,
  CollectionType,
  Serialized extends object,
> implements Iterable<Member> {
  readonly #saveMembership?: (models: Member[]) => void;

  protected constructor(
    readonly models: Member[],
    saveMembership?: (models: Member[]) => void,
  ) {
    this.#saveMembership = saveMembership;
  }

  protected abstract readonly description: string;

  get length(): number {
    return this.models.length;
  }

  add(model: Member): this {
    this.assertCompatible(model);

    if (!this.includes(model)) {
      this.models.push(model);
    }

    return this;
  }

  destroy(): void {
    for (const model of this.models) {
      model.destroy();
    }
  }

  filter(callback: (model: Member, index: number, collection: this) => boolean): CollectionType {
    return this.clone(this.models.filter((model, index) => callback(model, index, this)));
  }

  includes(model: Member): boolean {
    return this.models.some(
      (candidate) => candidate.modelName === model.modelName && candidate.id === model.id,
    );
  }

  mergeCollection(collection: CollectionType): this {
    this.assertCollectionCompatible(collection);

    for (const model of this.collectionMembers(collection)) {
      this.add(model);
    }

    return this;
  }

  reload(): this {
    for (const model of this.models) {
      model.reload();
    }

    return this;
  }

  remove(model: Member): this {
    const index = this.models.findIndex(
      (candidate) => candidate.modelName === model.modelName && candidate.id === model.id,
    );

    if (index !== -1) {
      this.models.splice(index, 1);
    }

    return this;
  }

  save(): this {
    for (const model of this.models) {
      model.save();
    }

    this.#saveMembership?.(this.models);
    return this;
  }

  slice(begin?: number, end?: number): CollectionType {
    return this.clone(this.models.slice(begin, end));
  }

  sort(callback: (left: Member, right: Member) => number): CollectionType {
    return this.clone([...this.models].sort(callback));
  }

  toJSON(): Serialized[] {
    return this.models.map((instance) => instance.toJSON());
  }

  toString(): string {
    return `${this.description}(${this.models
      .map((model) => `${model.modelName}:${model.id}`)
      .join(",")})`;
  }

  [Symbol.iterator](): Iterator<Member> {
    return this.models[Symbol.iterator]();
  }

  protected abstract assertCollectionCompatible(collection: CollectionType): void;
  protected abstract assertCompatible(model: Member): void;
  protected abstract clone(models: Member[]): CollectionType;
  protected abstract collectionMembers(collection: CollectionType): Iterable<Member>;

  protected updateAll(attributes: object): this {
    for (const model of this.models) {
      const update = Reflect.get(model, "update") as (attributes: object) => unknown;
      Reflect.apply(update, model, [attributes]);
    }

    return this;
  }
}

/**
 * A result containing zero or more model instances.
 */
export class Collection<
  Attributes extends object,
  Models extends ModelRegistry = {},
  Relationships extends RelationshipRegistry = {},
> extends CollectionBase<
  Model<Attributes, Models, Relationships>,
  Collection<Attributes, Models, Relationships>,
  StoredRecord<Attributes>
> {
  /** Label used in error messages. */
  protected readonly description: string;

  /** Wrap models of one type in a collection. */
  constructor(
    readonly modelName: string,
    models: Model<Attributes, Models, Relationships>[],
    saveMembership?: (models: Model<Attributes, Models, Relationships>[]) => void,
  ) {
    super(models, saveMembership);
    this.description = `collection:${modelName}`;
  }

  /** Update the same attributes on every model in the collection. */
  update(attributes: UpdateAttributes<Attributes>): this;
  /** Update one attribute on every model in the collection. */
  update<Name extends keyof UpdateAttributes<Attributes>>(
    key: Name,
    value: UpdateAttributes<Attributes>[Name],
  ): this;
  update(
    attributesOrKey: UpdateAttributes<Attributes> | keyof UpdateAttributes<Attributes>,
    value?: UpdateAttributes<Attributes>[keyof UpdateAttributes<Attributes>],
  ): this {
    const attributes =
      typeof attributesOrKey === "object"
        ? attributesOrKey
        : ({ [attributesOrKey]: value } as UpdateAttributes<Attributes>);
    return this.updateAll(attributes);
  }

  /** Throws if the collection holds a different model type. */
  protected assertCollectionCompatible(
    collection: Collection<Attributes, Models, Relationships>,
  ): void {
    if (collection.modelName !== this.modelName) {
      throw new TypeError(
        `Cannot merge collection:${collection.modelName} into collection:${this.modelName}.`,
      );
    }
  }

  /** Throws if the model is a different model type. */
  protected assertCompatible(model: Model<Attributes, Models, Relationships>): void {
    if (model.modelName !== this.modelName) {
      throw new TypeError(
        `Cannot add ${model.modelName}:${model.id} to collection:${this.modelName}.`,
      );
    }
  }

  /** Create a collection of the same model type. */
  protected clone(
    models: Model<Attributes, Models, Relationships>[],
  ): Collection<Attributes, Models, Relationships> {
    return new Collection(this.modelName, models);
  }

  /** The models of another collection of the same type. */
  protected collectionMembers(
    collection: Collection<Attributes, Models, Relationships>,
  ): Iterable<Model<Attributes, Models, Relationships>> {
    return collection;
  }
}

/**
 * A heterogeneous result from a polymorphic to-many relationship.
 */
export class PolymorphicCollection<
  Models extends ModelRegistry,
  Targets extends readonly string[] = readonly string[],
> extends CollectionBase<
  PolymorphicModelFor<Models, Targets>,
  PolymorphicCollection<Models, Targets>,
  StoredRecord<object>
> {
  /** Label used in error messages. */
  protected readonly description = "polymorphicCollection";

  /** Wrap models of any of the target types in a polymorphic collection. */
  constructor(
    readonly modelNames: Targets,
    models: PolymorphicModelFor<Models, Targets>[],
    saveMembership?: (models: PolymorphicModelFor<Models, Targets>[]) => void,
  ) {
    super(models, saveMembership);
  }

  /** Update attributes shared by every target model on every member. */
  update<Attributes extends PolymorphicUpdateAttributes<Models, Targets>>(
    attributes: Attributes &
      Record<Exclude<keyof Attributes, keyof PolymorphicUpdateAttributes<Models, Targets>>, never>,
  ): this;
  /** Update one attribute shared by every target model on every member. */
  update<Key extends keyof PolymorphicUpdateAttributes<Models, Targets>>(
    key: Key,
    value: PolymorphicUpdateAttributes<Models, Targets>[Key],
  ): this;
  update(
    attributesOrKey:
      | PolymorphicUpdateAttributes<Models, Targets>
      | keyof PolymorphicUpdateAttributes<Models, Targets>,
    value?: PolymorphicUpdateAttributes<Models, Targets>[keyof PolymorphicUpdateAttributes<
      Models,
      Targets
    >],
  ): this {
    const attributes =
      typeof attributesOrKey === "object" ? attributesOrKey : { [attributesOrKey]: value };
    return this.updateAll(attributes);
  }

  /** Throws if the collection accepts different target models. */
  protected assertCollectionCompatible(collection: PolymorphicCollection<Models, Targets>): void {
    if (
      collection.modelNames.length !== this.modelNames.length ||
      collection.modelNames.some((modelName) => !this.modelNames.includes(modelName))
    ) {
      throw new TypeError(
        `Cannot merge a polymorphic collection accepting ${collection.modelNames.join(
          ", ",
        )} into one accepting ${this.modelNames.join(", ")}.`,
      );
    }
  }

  /** Throws if the model is not one of the target models. */
  protected assertCompatible(model: PolymorphicModelFor<Models, Targets>): void {
    if (!this.modelNames.includes(model.modelName)) {
      throw new TypeError(
        `Cannot add ${model.modelName}:${model.id} to a polymorphic collection accepting ${this.modelNames.join(
          ", ",
        )}.`,
      );
    }
  }

  /** Create a collection with the same target models. */
  protected clone(
    models: PolymorphicModelFor<Models, Targets>[],
  ): PolymorphicCollection<Models, Targets> {
    return new PolymorphicCollection(this.modelNames, models);
  }

  /** The models of another polymorphic collection. */
  protected collectionMembers(
    collection: PolymorphicCollection<Models, Targets>,
  ): Iterable<PolymorphicModelFor<Models, Targets>> {
    return collection;
  }
}

type CreateModelAttributes<
  Attributes extends object,
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
> = InsertableRecord<Attributes> & RelationshipInputs<Models, Relationships>;

/** The input accepted by `create()` for a model, including relationship values. */
export type ModelCreateInput<
  Models extends ModelRegistry,
  Name extends keyof Models,
> = CreateModelAttributes<ModelAttributes<Models[Name]>, Models, ModelRelationships<Models[Name]>>;

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

  /** Create a model collection. Kajo builds these for you through the schema. */
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

  /** All models in the collection. */
  all(): Collection<Attributes, Models, Relationships> {
    return this.#wrapMany([...this.#collection]);
  }

  /** Insert a model and assign its relationships. */
  create(
    input: CreateModelAttributes<Attributes, Models, Relationships>,
  ): Model<Attributes, Models, Relationships> {
    const { attributes, relationshipValues } = splitModelInput(input, this.#relationships);

    const instance = this.#wrap(
      this.#collection.insert(attributes as InsertableRecord<Attributes>),
    );

    for (const [name, value] of relationshipValues) {
      Reflect.set(instance, name, value);
    }

    return instance;
  }

  /** Build an unsaved model. Call `save()` to insert it. */
  new(
    input: Omit<CreateModelAttributes<Attributes, Models, Relationships>, "id">,
  ): NewModel<Attributes, Models, Relationships> {
    const { attributes, relationshipValues } = splitModelInput(input, this.#relationships);
    return createNewModel(
      this.modelName,
      this.#collection,
      { ...attributes, id: null } as NewModelRecord<Attributes>,
      relationshipValues,
      this.#models,
      this.#relationships,
      this.#schema,
    );
  }

  /** Find a model by ID, or `null` if none exists. */
  find(id: number | string): Model<Attributes, Models, Relationships> | null;
  /** Find the models with the given IDs. */
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

  /** The first model matching every key in the query, or `null`. */
  findBy(query: RecordQuery<Attributes>): Model<Attributes, Models, Relationships> | null {
    const record = this.#collection.findBy(query);
    return record ? this.#wrap(record) : null;
  }

  /** Find a model matching the query, or create one from the query and extra attributes. */
  findOrCreateBy(
    query: RecordQuery<Attributes>,
    attributes: Partial<CreateModelAttributes<Attributes, Models, Relationships>> = {},
  ): Model<Attributes, Models, Relationships> {
    return (
      this.findBy(query) ??
      this.create({
        ...query,
        ...attributes,
      } as CreateModelAttributes<Attributes, Models, Relationships>)
    );
  }

  /** The first model in the collection, or `null` if it is empty. */
  first(): Model<Attributes, Models, Relationships> | null {
    const record = this.#collection[0];
    return record ? this.#wrap(record) : null;
  }

  /** An empty collection of this model type. */
  none(): Collection<Attributes, Models, Relationships> {
    return this.#wrapMany([]);
  }

  /** All models matching every key in the query. */
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

/** The typed schema API: `db` plus a model collection for every database table. */
export type Schema<
  Tables extends DatabaseData = DatabaseData,
  Models extends ModelRegistry = {},
> = {
  readonly db: Database<Tables>;
} & {
  readonly [Name in keyof Tables]: SchemaCollection<Tables, Models, Name>;
};

/** Create a schema over a database, wrapping each table in a model collection. */
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

export function singularize(name: string): string {
  if (name.endsWith("ies")) {
    return `${name.slice(0, -3)}y`;
  }

  if (/(?:ses|xes|zes|ches|shes)$/i.test(name)) {
    return name.slice(0, -2);
  }

  return name.endsWith("s") ? name.slice(0, -1) : name;
}

function splitModelInput<Relationships extends RelationshipRegistry>(
  input: object,
  relationships: Relationships,
): {
  attributes: Record<string, unknown>;
  relationshipValues: Map<string, unknown>;
} {
  const attributes = { ...input } as Record<string, unknown>;
  const relationshipValues = new Map<string, unknown>();

  for (const name of Object.keys(relationships)) {
    if (name in attributes) {
      relationshipValues.set(name, attributes[name]);
      delete attributes[name];
    }
  }

  return { attributes, relationshipValues };
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
    [MODEL_METADATA]: { relationships },
    get attrs() {
      return record;
    },
    get isDestroyed() {
      return isDestroyed;
    },
    modelName,
    destroy() {
      disassociateDependents(modelName, record, models, schema());
      collection.remove(record.id);
      isDestroyed = true;
    },
    isNew() {
      return collection.find(record.id) === null;
    },
    isSaved() {
      return collection.find(record.id) !== null;
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

      if (typeof property === "string") {
        const convenience = getRelationshipConvenience(
          property,
          relationships,
          schema(),
          (name) => Reflect.get(proxy, name),
          (name, value) => Reflect.set(proxy, name, value),
        );

        if (convenience !== NO_RELATIONSHIP_CONVENIENCE) {
          return convenience;
        }
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

      if (
        typeof property === "string" &&
        setRelationshipId(property, value, relationships, schema(), (name, related) =>
          Reflect.set(proxy, name, related),
        )
      ) {
        return true;
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

function createNewModel<
  Attributes extends object,
  Models extends ModelRegistry,
  Relationships extends RelationshipRegistry,
>(
  modelName: string,
  collection: DatabaseCollection<Attributes>,
  initialRecord: NewModelRecord<Attributes>,
  relationshipValues: Map<string, unknown>,
  models: Models,
  relationships: Relationships,
  schema: () => Schema<DatabaseData, Models>,
): NewModel<Attributes, Models, Relationships> {
  const afterSaveCallbacks: ((model: Model<Attributes, Models, Relationships>) => void)[] = [];
  let record: NewModelRecord<Attributes> | StoredRecord<Attributes> = initialRecord;
  let isDestroyed = false;
  let persisted = false;

  for (const [name, value] of relationshipValues) {
    if (value !== undefined) {
      validateRelationshipValue(value, relationships[name], name);
    }
  }

  const instance = {
    [MODEL_METADATA]: { relationships },
    [MODEL_AFTER_SAVE](callback: (model: Model<Attributes, Models, Relationships>) => void) {
      afterSaveCallbacks.push(callback);
    },
    get attrs() {
      return record;
    },
    get isDestroyed() {
      return isDestroyed;
    },
    modelName,
    destroy() {
      if (persisted) {
        const storedRecord = record as StoredRecord<Attributes>;
        disassociateDependents(modelName, storedRecord, models, schema());
        collection.remove(storedRecord.id);
        isDestroyed = true;
      }
    },
    isNew() {
      return !persisted || isDestroyed;
    },
    isSaved() {
      return persisted && !isDestroyed;
    },
    reload() {
      if (!persisted) {
        return proxy;
      }

      if (isDestroyed) {
        throw new Error(
          `Cannot reload destroyed ${modelName}:${(record as StoredRecord<Attributes>).id}.`,
        );
      }

      const current = collection.find((record as StoredRecord<Attributes>).id);

      if (!current) {
        throw new Error(
          `Cannot reload destroyed ${modelName}:${(record as StoredRecord<Attributes>).id}.`,
        );
      }

      record = current;
      return proxy;
    },
    save() {
      if (isDestroyed) {
        throw new Error(
          `Cannot save destroyed ${modelName}:${(record as StoredRecord<Attributes>).id}.`,
        );
      }

      if (persisted) {
        return proxy;
      }

      for (const [name, value] of relationshipValues) {
        validateRelationshipValue(value, relationships[name], name);
      }

      const { id: _id, ...attributes } = record;
      const inserted = collection.insert(attributes as InsertableRecord<Attributes>);
      record = inserted;
      persisted = true;

      try {
        for (const [name, value] of relationshipValues) {
          setRelationship(modelName, inserted, name, relationships[name], value, models, schema());
        }
        relationshipValues.clear();
      } catch (error) {
        collection.remove(inserted.id);
        record = initialRecord;
        persisted = false;
        throw error;
      }

      for (const callback of afterSaveCallbacks.splice(0)) {
        callback(proxy as unknown as Model<Attributes, Models, Relationships>);
      }

      return proxy;
    },
    toJSON() {
      return { ...record };
    },
    update(attributes: UpdateAttributes<Attributes>) {
      for (const [name, value] of Object.entries(attributes)) {
        Reflect.set(proxy, name, value);
      }
      return instance.save();
    },
  };

  const proxy = new Proxy(instance, {
    get(target, property, receiver) {
      if (property in target) {
        return Reflect.get(target, property, receiver);
      }

      if (typeof property === "string") {
        const convenience = getRelationshipConvenience(
          property,
          relationships,
          schema(),
          (name) => Reflect.get(proxy, name),
          (name, value) => Reflect.set(proxy, name, value),
        );

        if (convenience !== NO_RELATIONSHIP_CONVENIENCE) {
          return convenience;
        }
      }

      if (typeof property === "string" && property in relationships) {
        if (persisted) {
          return getRelationship(
            modelName,
            record as StoredRecord<Attributes>,
            property,
            relationships[property],
            models,
            schema(),
          );
        }

        return getNewRelationship(
          relationshipValues.get(property),
          property,
          relationships[property],
          schema(),
        );
      }

      return record[property as keyof typeof record];
    },
    set(target, property, value, receiver) {
      if (property in target) {
        return Reflect.set(target, property, value, receiver);
      }

      if (property === "id") {
        throw new TypeError("Model ids cannot be changed.");
      }

      if (
        typeof property === "string" &&
        setRelationshipId(property, value, relationships, schema(), (name, related) =>
          Reflect.set(proxy, name, related),
        )
      ) {
        return true;
      }

      if (typeof property === "string" && property in relationships) {
        if (persisted) {
          setRelationship(
            modelName,
            record as StoredRecord<Attributes>,
            property,
            relationships[property],
            value,
            models,
            schema(),
          );
        } else {
          validateRelationshipValue(value, relationships[property], property);
          relationshipValues.set(property, value);
        }
        return true;
      }

      Reflect.set(record, property, value);
      return true;
    },
  }) as unknown as NewModel<Attributes, Models, Relationships>;

  return proxy;
}

function getNewRelationship<Models extends ModelRegistry>(
  value: unknown,
  relationshipName: string,
  relationship: RelationshipDefinition,
  schema: Schema<DatabaseData, Models>,
): unknown {
  if (relationship.kind === "belongsTo") {
    return value ?? null;
  }

  if (value instanceof Collection || value instanceof PolymorphicCollection) {
    return value;
  }

  if (isPolymorphicHasMany(relationship)) {
    const related = Array.isArray(value)
      ? value.map((model) => {
          const target = asRuntimeModel(model);
          assertRelationshipTarget(relationship, target.modelName, relationshipName);
          return model;
        })
      : [];
    return new PolymorphicCollection(
      relationship.modelNames,
      related as unknown as PolymorphicModelFor<Models, typeof relationship.modelNames>[],
    );
  }

  const collection = schema[pluralize(relationship.modelName)] as unknown as ModelCollection<
    object,
    Models,
    RelationshipRegistry
  >;
  return Array.isArray(value)
    ? collection.find(value.map((model) => asRuntimeModel(model).id))
    : collection.none();
}

function validateRelationshipValue(
  value: unknown,
  relationship: RelationshipDefinition,
  name: string,
): void {
  if (relationship.kind === "belongsTo") {
    if (value !== null && value !== undefined) {
      const model = asRuntimeModel(value, name);
      assertRelationshipTarget(relationship, model.modelName, name);
    }
    return;
  }

  if (
    !(value instanceof Collection) &&
    !(value instanceof PolymorphicCollection) &&
    !Array.isArray(value)
  ) {
    throw new TypeError('The "hasMany" relationship expects model instances.');
  }

  const values =
    value instanceof Collection || value instanceof PolymorphicCollection ? value.models : value;
  values.forEach((model) => {
    const target = asRuntimeModel(model);
    assertRelationshipTarget(relationship, target.modelName, name);
  });
}

const NO_RELATIONSHIP_CONVENIENCE = Symbol("kajo.noRelationshipConvenience");

function getRelationshipConvenience<Models extends ModelRegistry>(
  property: string,
  relationships: RelationshipRegistry,
  schema: Schema<DatabaseData, Models>,
  getRelated: (name: string) => unknown,
  setRelated: (name: string, value: unknown) => boolean,
): unknown {
  for (const [name, relationship] of Object.entries(relationships)) {
    const helperName =
      relationship.kind === "belongsTo" ? capitalize(name) : capitalize(singularize(name));

    if (property === foreignKey(name, relationship)) {
      const related = getRelated(name);

      if (relationship.kind === "belongsTo") {
        if (related === null) {
          return null;
        }

        const model = asRuntimeModel(related, name);
        return isPolymorphicBelongsTo(relationship)
          ? { id: model.id, type: model.modelName }
          : model.id;
      }

      const relatedModels =
        related instanceof Collection || related instanceof PolymorphicCollection
          ? related.models
          : [];
      return isPolymorphicHasMany(relationship)
        ? relatedModels.map(({ id, modelName: type }) => ({ id, type }))
        : relatedModels.map(({ id }) => id);
    }

    if (property !== `new${helperName}` && property !== `create${helperName}`) {
      continue;
    }

    const createRelated = (targetModelName: string, attributes: object, persist: boolean) => {
      assertRelationshipTarget(relationship, targetModelName, name);
      const targetCollection = schema[pluralize(targetModelName)] as unknown as ModelCollection<
        object,
        Models,
        RelationshipRegistry
      >;

      if (persist) {
        const target = targetCollection.create(attributes);
        addRelatedModel(name, relationship, target, getRelated, setRelated);
        return target;
      }

      const target = targetCollection.new(
        attributes as Omit<CreateModelAttributes<object, Models, RelationshipRegistry>, "id">,
      );
      const registerAfterSave = Reflect.get(target, MODEL_AFTER_SAVE) as (
        callback: (model: Model<object, Models, RelationshipRegistry>) => void,
      ) => void;
      registerAfterSave((saved) => {
        addRelatedModel(name, relationship, saved, getRelated, setRelated);
      });
      return target;
    };

    const persist = property === `create${helperName}`;

    if (isPolymorphicBelongsTo(relationship) || isPolymorphicHasMany(relationship)) {
      return (targetModelName: string, attributes: object) =>
        createRelated(targetModelName, attributes, persist);
    }

    return (attributes: object) => createRelated(relationship.modelName, attributes, persist);
  }

  return NO_RELATIONSHIP_CONVENIENCE;
}

function setRelationshipId<Models extends ModelRegistry>(
  property: string,
  value: unknown,
  relationships: RelationshipRegistry,
  schema: Schema<DatabaseData, Models>,
  setRelated: (name: string, value: unknown) => boolean,
): boolean {
  for (const [name, relationship] of Object.entries(relationships)) {
    if (property !== foreignKey(name, relationship)) {
      continue;
    }

    if (relationship.kind === "belongsTo" && (value === null || value === undefined)) {
      setRelated(name, null);
      return true;
    }

    if (relationship.kind === "belongsTo") {
      const identifier = isPolymorphicBelongsTo(relationship)
        ? asPolymorphicIdentifier(value, property)
        : { id: String(value), type: relationship.modelName };
      assertRelationshipTarget(relationship, identifier.type, name);
      const targetCollection = schema[pluralize(identifier.type)] as unknown as ModelCollection<
        object,
        Models,
        RelationshipRegistry
      >;
      const target = targetCollection.find(identifier.id);

      if (!target) {
        throw new Error(`No ${identifier.type} with id "${identifier.id}" was found.`);
      }

      setRelated(name, target);
      return true;
    }

    if (isPolymorphicHasMany(relationship)) {
      if (!Array.isArray(value)) {
        throw new TypeError(`The "${property}" relationship id property expects an array of ids.`);
      }

      const targets = value.map((item) => {
        const identifier = asPolymorphicIdentifier(item, property);
        assertRelationshipTarget(relationship, identifier.type, name);
        const collection = schema[pluralize(identifier.type)] as unknown as ModelCollection<
          object,
          Models,
          RelationshipRegistry
        >;
        const target = collection.find(identifier.id);

        if (!target) {
          throw new Error(`No ${identifier.type} with id "${identifier.id}" was found.`);
        }

        return target;
      });
      setRelated(name, targets);
      return true;
    }

    const targetCollection = schema[
      pluralize(relationship.modelName)
    ] as unknown as ModelCollection<object, Models, RelationshipRegistry>;

    if (!Array.isArray(value)) {
      throw new TypeError(`The "${property}" relationship id property expects an array of ids.`);
    }

    const ids = value.map(String);
    const targets = targetCollection.find(ids);

    if (targets.length !== ids.length) {
      const found = new Set(targets.models.map(({ id }) => id));
      const missing = ids.find((id) => !found.has(id));
      throw new Error(`No ${relationship.modelName} with id "${missing}" was found.`);
    }

    setRelated(name, targets);
    return true;
  }

  return false;
}

function addRelatedModel(
  name: string,
  relationship: RelationshipDefinition,
  target: RuntimeModel,
  getRelated: (name: string) => unknown,
  setRelated: (name: string, value: unknown) => boolean,
): void {
  if (relationship.kind === "belongsTo") {
    setRelated(name, target);
    return;
  }

  const related = getRelated(name);
  const models =
    related instanceof Collection || related instanceof PolymorphicCollection ? related.models : [];
  setRelated(name, [...models, target]);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getRelationship<Models extends ModelRegistry>(
  sourceModelName: string,
  sourceRecord: StoredRecord<object>,
  relationshipName: string,
  relationship: RelationshipDefinition,
  models: Models,
  schema: Schema<DatabaseData, Models>,
): unknown {
  if (relationship.kind === "belongsTo") {
    const stored = Reflect.get(sourceRecord, foreignKey(relationshipName, relationship));

    if (stored === undefined || stored === null) {
      return null;
    }

    const identifier = isPolymorphicBelongsTo(relationship)
      ? asPolymorphicIdentifier(stored, foreignKey(relationshipName))
      : { id: String(stored), type: relationship.modelName };
    assertRelationshipTarget(relationship, identifier.type, relationshipName);
    const targetCollection = schema[pluralize(identifier.type)] as unknown as ModelCollection<
      object,
      Models,
      RelationshipRegistry
    >;
    return targetCollection.find(identifier.id);
  }

  if (isPolymorphicHasMany(relationship)) {
    const stored = Reflect.get(sourceRecord, foreignKey(relationshipName, relationship));
    const identifiers = Array.isArray(stored)
      ? stored.map((value) =>
          asPolymorphicIdentifier(value, foreignKey(relationshipName, relationship)),
        )
      : [];
    const related: RuntimeModel[] = [];
    const included = new Set<string>();

    for (const identifier of identifiers) {
      assertRelationshipTarget(relationship, identifier.type, relationshipName);
      const targetCollection = schema[pluralize(identifier.type)] as unknown as ModelCollection<
        object,
        Models,
        RelationshipRegistry
      >;
      const target = targetCollection.find(identifier.id);

      if (target) {
        const inverse = findInverse(sourceModelName, relationship, models, identifier.type);
        const inverseValue =
          inverse?.definition.kind === "belongsTo"
            ? Reflect.get(target.attrs, foreignKey(inverse.name))
            : undefined;
        const belongsToSource =
          inverse?.definition.kind !== "belongsTo" ||
          inverseBelongsToSource(
            inverse.definition,
            inverseValue,
            sourceModelName,
            sourceRecord.id,
          );

        if (!belongsToSource) {
          continue;
        }

        related.push(target);
        included.add(`${identifier.type}:${identifier.id}`);
      }
    }

    for (const targetModelName of relationship.modelNames) {
      const targetCollection = schema[pluralize(targetModelName)] as unknown as ModelCollection<
        object,
        Models,
        RelationshipRegistry
      >;
      const inverse = findInverse(sourceModelName, relationship, models, targetModelName);

      if (inverse?.definition.kind === "belongsTo") {
        for (const target of targetCollection.all()) {
          const inverseValue = Reflect.get(target.attrs, foreignKey(inverse.name));
          const belongsToSource = inverseBelongsToSource(
            inverse.definition,
            inverseValue,
            sourceModelName,
            sourceRecord.id,
          );

          if (belongsToSource && !included.has(`${targetModelName}:${target.id}`)) {
            related.push(target);
          }
        }
      }
    }

    return new PolymorphicCollection(
      relationship.modelNames,
      related as unknown as PolymorphicModelFor<Models, typeof relationship.modelNames>[],
      (relatedModels) => {
        setRelationship(
          sourceModelName,
          sourceRecord,
          relationshipName,
          relationship,
          relatedModels,
          models,
          schema,
        );
      },
    );
  }

  const inverse = findInverse(sourceModelName, relationship, models);
  const targetCollection = schema[pluralize(relationship.modelName)] as unknown as ModelCollection<
    object,
    Models,
    RelationshipRegistry
  >;
  const withMembershipPersistence = (
    collection: Collection<object, Models, RelationshipRegistry>,
  ) =>
    new Collection(collection.modelName, collection.models, (relatedModels) => {
      setRelationship(
        sourceModelName,
        sourceRecord,
        relationshipName,
        relationship,
        relatedModels,
        models,
        schema,
      );
    });

  if (inverse?.definition.kind === "belongsTo") {
    if (isPolymorphicBelongsTo(inverse.definition)) {
      return withMembershipPersistence(
        targetCollection.find(
          targetCollection
            .all()
            .models.filter((target) => {
              const identifier = Reflect.get(target.attrs, foreignKey(inverse.name));
              return (
                isPolymorphicIdentifier(identifier) &&
                identifier.type === sourceModelName &&
                String(identifier.id) === sourceRecord.id
              );
            })
            .map(({ id }) => id),
        ),
      );
    }

    return withMembershipPersistence(
      targetCollection.where({
        [foreignKey(inverse.name, inverse.definition)]: sourceRecord.id,
      }),
    );
  }

  const ids = Reflect.get(sourceRecord, foreignKey(relationshipName, relationship));
  return withMembershipPersistence(
    targetCollection.find(Array.isArray(ids) ? ids.map(String) : []),
  );
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
    const relationshipKey = foreignKey(relationshipName);
    const previousValue = Reflect.get(sourceRecord, relationshipKey);
    const previousIdentifier =
      previousValue === undefined || previousValue === null
        ? undefined
        : isPolymorphicBelongsTo(relationship)
          ? asPolymorphicIdentifier(previousValue, relationshipKey)
          : { id: String(previousValue), type: relationship.modelName };
    const previousInverse = previousIdentifier
      ? findInverse(sourceModelName, relationship, models, previousIdentifier.type)
      : undefined;

    if (previousInverse?.definition.kind === "belongsTo" && previousIdentifier) {
      const previousCollection = schema[
        pluralize(previousIdentifier.type)
      ] as unknown as ModelCollection<object, Models, RelationshipRegistry>;
      const previous = previousCollection.find(previousIdentifier.id);

      if (
        previous &&
        inverseBelongsToSource(
          previousInverse.definition,
          Reflect.get(previous.attrs, foreignKey(previousInverse.name)),
          sourceModelName,
          sourceRecord.id,
        )
      ) {
        Reflect.deleteProperty(previous.attrs, foreignKey(previousInverse.name));
      }
    }

    if (value === null || value === undefined) {
      Reflect.deleteProperty(sourceRecord, relationshipKey);
      return;
    }

    const target = asRuntimeModel(value, relationshipName);
    assertRelationshipTarget(relationship, target.modelName, relationshipName);
    const inverse = findInverse(sourceModelName, relationship, models, target.modelName);
    Reflect.set(
      sourceRecord,
      relationshipKey,
      isPolymorphicBelongsTo(relationship) ? { id: target.id, type: target.modelName } : target.id,
    );

    if (inverse?.definition.kind === "belongsTo") {
      Reflect.set(
        target.attrs,
        foreignKey(inverse.name),
        isPolymorphicBelongsTo(inverse.definition)
          ? { id: sourceRecord.id, type: sourceModelName }
          : sourceRecord.id,
      );
    }
    return;
  }

  if (isPolymorphicHasMany(relationship)) {
    const values: unknown[] =
      value instanceof Collection || value instanceof PolymorphicCollection
        ? value.models
        : Array.isArray(value)
          ? value
          : [];
    const targets = values.map((target) => asRuntimeModel(target));
    targets.forEach((target) =>
      assertRelationshipTarget(relationship, target.modelName, relationshipName),
    );
    const selected = new Set(targets.map((target) => `${target.modelName}:${target.id}`));
    const relationshipKey = collectionForeignKey(relationshipName);
    const previous = new Set(
      Array.isArray(Reflect.get(sourceRecord, relationshipKey))
        ? (Reflect.get(sourceRecord, relationshipKey) as unknown[])
            .filter(isPolymorphicIdentifier)
            .map(({ id, type }) => `${type}:${id}`)
        : [],
    );

    Reflect.set(
      sourceRecord,
      relationshipKey,
      targets
        .filter(
          (target) =>
            findInverse(sourceModelName, relationship, models, target.modelName)?.definition
              .kind !== "belongsTo",
        )
        .map(({ id, modelName: type }) => ({ id, type })),
    );

    for (const targetModelName of relationship.modelNames) {
      const inverse = findInverse(sourceModelName, relationship, models, targetModelName);

      if (!inverse) {
        continue;
      }

      const targetCollection = schema[pluralize(targetModelName)] as unknown as ModelCollection<
        object,
        Models,
        RelationshipRegistry
      >;

      for (const target of targetCollection.all()) {
        const identity = `${targetModelName}:${target.id}`;
        const isSelected = selected.has(identity);
        const wasSelected = previous.has(identity);

        if (!isSelected && !wasSelected && inverse.definition.kind !== "belongsTo") {
          continue;
        }

        if (inverse.definition.kind === "belongsTo") {
          const inverseKey = foreignKey(inverse.name);
          const inverseValue = Reflect.get(target.attrs, inverseKey);
          const belongsToSource = inverseBelongsToSource(
            inverse.definition,
            inverseValue,
            sourceModelName,
            sourceRecord.id,
          );

          if (isSelected) {
            Reflect.set(
              target.attrs,
              inverseKey,
              isPolymorphicBelongsTo(inverse.definition)
                ? { id: sourceRecord.id, type: sourceModelName }
                : sourceRecord.id,
            );
          } else if (belongsToSource) {
            Reflect.deleteProperty(target.attrs, inverseKey);
          }
          continue;
        }

        const inverseKey = collectionForeignKey(inverse.name);
        const inverseValues = Array.isArray(Reflect.get(target.attrs, inverseKey))
          ? [...(Reflect.get(target.attrs, inverseKey) as unknown[])]
          : [];

        if (isPolymorphicHasMany(inverse.definition)) {
          const sourceIdentity = `${sourceModelName}:${sourceRecord.id}`;
          const withoutSource = inverseValues.filter(
            (item) =>
              !isPolymorphicIdentifier(item) || `${item.type}:${item.id}` !== sourceIdentity,
          );
          Reflect.set(
            target.attrs,
            inverseKey,
            isSelected
              ? [...withoutSource, { id: sourceRecord.id, type: sourceModelName }]
              : withoutSource,
          );
        } else {
          const ids = new Set(inverseValues.map(String));
          if (isSelected) {
            ids.add(sourceRecord.id);
          } else {
            ids.delete(sourceRecord.id);
          }
          Reflect.set(target.attrs, inverseKey, [...ids]);
        }
      }
    }
    return;
  }

  const values: unknown[] =
    value instanceof Collection || value instanceof PolymorphicCollection
      ? value.models
      : Array.isArray(value)
        ? value
        : [];
  const targets = values.map((target) => asRuntimeModel(target));
  targets.forEach((target) =>
    assertRelationshipTarget(relationship, target.modelName, relationshipName),
  );
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
      const inverseValue = Reflect.get(target.attrs, inverseKey);
      const belongsToSource = inverseBelongsToSource(
        inverse.definition,
        inverseValue,
        sourceModelName,
        sourceRecord.id,
      );

      if (belongsToSource && !selectedIds.has(target.id)) {
        Reflect.deleteProperty(target.attrs, inverseKey);
      }
    }

    for (const target of targets) {
      Reflect.set(
        target.attrs,
        inverseKey,
        isPolymorphicBelongsTo(inverse.definition)
          ? { id: sourceRecord.id, type: sourceModelName }
          : sourceRecord.id,
      );
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

      if (isPolymorphicHasMany(inverse.definition)) {
        const sourceIdentity = `${sourceModelName}:${sourceRecord.id}`;
        const inverseIds = Array.isArray(Reflect.get(target.attrs, inverseKey))
          ? (Reflect.get(target.attrs, inverseKey) as unknown[])
          : [];
        const withoutSource = inverseIds.filter(
          (value) =>
            !isPolymorphicIdentifier(value) || `${value.type}:${value.id}` !== sourceIdentity,
        );
        Reflect.set(
          target.attrs,
          inverseKey,
          selectedIds.has(target.id)
            ? [...withoutSource, { id: sourceRecord.id, type: sourceModelName }]
            : withoutSource,
        );
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

function disassociateDependents<Models extends ModelRegistry>(
  targetModelName: string,
  targetRecord: StoredRecord<object>,
  models: Models,
  schema: Schema<DatabaseData, Models>,
): void {
  for (const [ownerModelName, definition] of Object.entries(models)) {
    const ownerCollection = schema.db[pluralize(ownerModelName)] as
      | DatabaseCollection<object>
      | undefined;

    if (!ownerCollection) {
      continue;
    }

    for (const [relationshipName, relationship] of Object.entries(definition.relationships)) {
      if (!relationshipModelNames(relationship).includes(targetModelName)) {
        continue;
      }

      const relationshipKey = foreignKey(relationshipName, relationship);

      for (const ownerRecord of ownerCollection) {
        if (relationship.kind === "belongsTo") {
          const value = Reflect.get(ownerRecord, relationshipKey);
          const matches = isPolymorphicBelongsTo(relationship)
            ? isPolymorphicIdentifier(value) &&
              value.type === targetModelName &&
              String(value.id) === targetRecord.id
            : String(value) === targetRecord.id;

          if (matches) {
            Reflect.deleteProperty(ownerRecord, relationshipKey);
          }
          continue;
        }

        const ids = Reflect.get(ownerRecord, relationshipKey);

        if (Array.isArray(ids)) {
          Reflect.set(
            ownerRecord,
            relationshipKey,
            isPolymorphicHasMany(relationship)
              ? ids.filter(
                  (value) =>
                    !isPolymorphicIdentifier(value) ||
                    value.type !== targetModelName ||
                    String(value.id) !== targetRecord.id,
                )
              : ids.map(String).filter((id) => id !== targetRecord.id),
          );
        }
      }
    }
  }
}

function findInverse(
  sourceModelName: string,
  relationship: RelationshipDefinition,
  models: ModelRegistry,
  targetModelName = relationshipModelNames(relationship)[0],
):
  | {
      readonly definition: RelationshipDefinition;
      readonly name: string;
    }
  | undefined {
  if (relationship.inverse === null) {
    return undefined;
  }

  const target = models[targetModelName];

  if (!target) {
    return undefined;
  }

  if (relationship.inverse) {
    const definition = target.relationships[relationship.inverse];
    return definition ? { definition, name: relationship.inverse } : undefined;
  }

  const matches = Object.entries(target.relationships).filter(([, candidate]) =>
    relationshipModelNames(candidate).includes(sourceModelName),
  );

  return matches.length === 1 ? { definition: matches[0][1], name: matches[0][0] } : undefined;
}

function foreignKey(relationshipName: string, relationship?: RelationshipDefinition): string {
  return relationship?.kind === "hasMany"
    ? collectionForeignKey(relationshipName)
    : `${relationshipName}Id`;
}

function collectionForeignKey(relationshipName: string): string {
  return `${singularize(relationshipName)}Ids`;
}

function validateModels(models: ModelRegistry): void {
  for (const [sourceName, definition] of Object.entries(models)) {
    for (const [relationshipName, relationship] of Object.entries(definition.relationships)) {
      for (const targetModelName of relationshipModelNames(relationship)) {
        const target = models[targetModelName];

        if (!target) {
          throw new Error(
            `Relationship "${sourceName}.${relationshipName}" targets unknown model "${targetModelName}".`,
          );
        }

        if (typeof relationship.inverse !== "string") {
          continue;
        }

        const inverse = target.relationships[relationship.inverse];

        if (!inverse || !relationshipModelNames(inverse).includes(sourceName)) {
          throw new Error(
            `Relationship "${sourceName}.${relationshipName}" has invalid inverse "${targetModelName}.${relationship.inverse}".`,
          );
        }
      }
    }
  }
}

interface RuntimeModel {
  readonly attrs: object;
  readonly id: string;
  readonly modelName: string;
}

function asRuntimeModel(value: unknown, relationshipName = "hasMany"): RuntimeModel {
  const id = typeof value === "object" && value !== null ? Reflect.get(value, "id") : undefined;
  const attrs =
    typeof value === "object" && value !== null ? Reflect.get(value, "attrs") : undefined;
  const modelName =
    typeof value === "object" && value !== null ? Reflect.get(value, "modelName") : undefined;

  if (
    typeof value !== "object" ||
    value === null ||
    id === undefined ||
    typeof modelName !== "string" ||
    typeof attrs !== "object" ||
    attrs === null
  ) {
    throw new TypeError(`The "${relationshipName}" relationship expects model instances.`);
  }

  return {
    attrs,
    id: String(id),
    modelName,
  };
}

function isPolymorphicBelongsTo(
  relationship: RelationshipDefinition,
): relationship is PolymorphicBelongsToDefinition {
  return relationship.kind === "belongsTo" && relationship.polymorphic === true;
}

function isPolymorphicHasMany(
  relationship: RelationshipDefinition,
): relationship is PolymorphicHasManyDefinition {
  return relationship.kind === "hasMany" && relationship.polymorphic === true;
}

function inverseBelongsToSource(
  relationship: BelongsToDefinition | PolymorphicBelongsToDefinition,
  value: unknown,
  sourceModelName: string,
  sourceId: string,
): boolean {
  return isPolymorphicBelongsTo(relationship)
    ? isPolymorphicIdentifier(value) &&
        value.type === sourceModelName &&
        String(value.id) === sourceId
    : String(value) === sourceId;
}

function relationshipModelNames(relationship: RelationshipDefinition): readonly string[] {
  return isPolymorphicBelongsTo(relationship) || isPolymorphicHasMany(relationship)
    ? relationship.modelNames
    : [relationship.modelName];
}

function assertRelationshipTarget(
  relationship: RelationshipDefinition,
  modelName: string,
  relationshipName: string,
): void {
  if (!relationshipModelNames(relationship).includes(modelName)) {
    throw new TypeError(
      `The "${relationshipName}" relationship does not accept models of type "${modelName}".`,
    );
  }
}

function isPolymorphicIdentifier(value: unknown): value is PolymorphicIdentifier {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "type") === "string" &&
    (typeof Reflect.get(value, "id") === "string" || typeof Reflect.get(value, "id") === "number")
  );
}

function asPolymorphicIdentifier(value: unknown, property: string): PolymorphicIdentifier {
  if (!isPolymorphicIdentifier(value)) {
    throw new TypeError(
      `The "${property}" relationship id property expects an object with "type" and "id"; received ${describeValue(
        value,
      )}.`,
    );
  }

  return {
    id: String(value.id),
    type: value.type,
  };
}

function describeValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}
