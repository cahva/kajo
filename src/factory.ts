import type { DatabaseData } from "./database.ts";
import type { Model, ModelRegistry, RelationshipRegistry } from "./model.ts";
import type { Server } from "./server.ts";

const TRAIT = Symbol("kajo.factory-trait");

export type FactoryModel<Attributes extends object> = Model<
  Attributes,
  ModelRegistry,
  RelationshipRegistry
>;

export type FactoryServer = Server<DatabaseData, ModelRegistry>;

export type FactoryAfterCreate<Created = FactoryModel<object>, Context = FactoryServer> = (
  model: Created,
  server: Context,
) => void;

export type FactoryAttribute<Attributes extends object, Name extends keyof Attributes> =
  | Attributes[Name]
  | ((this: Readonly<Attributes>, sequence: number) => Attributes[Name]);

/**
 * Base or trait attributes used to build a model.
 *
 * Function attributes receive a zero-based sequence and can read attributes
 * evaluated before them through `this`.
 */
export type FactoryDefinition<
  Attributes extends object,
  Created = FactoryModel<Attributes>,
  Context = FactoryServer,
> = {
  readonly [Name in keyof Attributes]?: FactoryAttribute<Attributes, Name>;
} & {
  readonly afterCreate?: FactoryAfterCreate<Created, Context>;
} & Readonly<Record<string, unknown>>;

export interface FactoryTrait<
  Attributes extends object = object,
  Created = FactoryModel<Attributes>,
  Context = FactoryServer,
> {
  readonly [TRAIT]: FactoryDefinition<Attributes, Created, Context>;
}

export interface FactoryBuild<
  Attributes extends object,
  Created = FactoryModel<Attributes>,
  Context = FactoryServer,
> {
  readonly afterCreate: readonly FactoryAfterCreate<Created, Context>[];
  readonly attributes: Partial<Attributes> & Record<string, unknown>;
}

/**
 * A reusable definition for generating model attributes.
 */
export class Factory<
  Attributes extends object = object,
  Created = FactoryModel<Attributes>,
  Context = FactoryServer,
> {
  static extend<
    Attributes extends object,
    Created = FactoryModel<Attributes>,
    Context = FactoryServer,
  >(
    definition: FactoryDefinition<Attributes, Created, Context>,
  ): Factory<Attributes, Created, Context> {
    return new Factory(definition);
  }

  readonly #definition: FactoryDefinition<Attributes, Created, Context>;

  constructor(definition: FactoryDefinition<Attributes, Created, Context> = {}) {
    this.#definition = definition;
  }

  /**
   * Evaluate this factory for one model.
   */
  build(
    sequence: number,
    traitNames: readonly string[] = [],
    overrides: Readonly<Record<string, unknown>> = {},
  ): FactoryBuild<Attributes, Created, Context> {
    const definitions = [this.#definition];

    for (const name of traitNames) {
      const selected = this.#definition[name];

      if (!isFactoryTrait(selected)) {
        throw new Error(`Factory does not define a "${name}" trait.`);
      }

      definitions.push(selected[TRAIT] as FactoryDefinition<Attributes, Created, Context>);
    }

    const afterCreate: FactoryAfterCreate<Created, Context>[] = [];
    const attributes: Record<string, unknown> = { ...overrides };

    for (const definition of definitions) {
      for (const [name, value] of Object.entries(definition)) {
        if (name === "afterCreate" && typeof value === "function") {
          afterCreate.push(value as FactoryAfterCreate<Created, Context>);
          continue;
        }

        if (isFactoryTrait(value) || Object.prototype.hasOwnProperty.call(overrides, name)) {
          continue;
        }

        attributes[name] =
          typeof value === "function" ? Reflect.apply(value, attributes, [sequence]) : value;
      }
    }

    return {
      afterCreate,
      attributes: attributes as Partial<Attributes> & Record<string, unknown>,
    };
  }
}

/**
 * Group factory attributes under a reusable name.
 */
export function trait<
  Attributes extends object,
  Created = FactoryModel<Attributes>,
  Context = FactoryServer,
>(
  definition: FactoryDefinition<Attributes, Created, Context>,
): FactoryTrait<Attributes, Created, Context> {
  return { [TRAIT]: definition };
}

function isFactoryTrait(value: unknown): value is FactoryTrait {
  return typeof value === "object" && value !== null && TRAIT in value;
}
