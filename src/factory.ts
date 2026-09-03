const TRAIT = Symbol("kajo.factory-trait");

export type FactoryAttribute<Attributes extends object, Name extends keyof Attributes> =
  | Attributes[Name]
  | ((this: Readonly<Attributes>, sequence: number) => Attributes[Name]);

/**
 * Base or trait attributes used to build a model.
 *
 * Function attributes receive a zero-based sequence and can read attributes
 * evaluated before them through `this`.
 */
export type FactoryDefinition<Attributes extends object> = {
  readonly [Name in keyof Attributes]?: FactoryAttribute<Attributes, Name>;
} & Readonly<Record<string, unknown>>;

export interface FactoryTrait<Attributes extends object = object> {
  readonly [TRAIT]: FactoryDefinition<Attributes>;
}

export interface FactoryBuild<Attributes extends object> {
  readonly attributes: Partial<Attributes> & Record<string, unknown>;
}

/**
 * A reusable definition for generating model attributes.
 */
export class Factory<Attributes extends object = object> {
  static extend<Attributes extends object>(
    definition: FactoryDefinition<Attributes>,
  ): Factory<Attributes> {
    return new Factory(definition);
  }

  readonly #definition: FactoryDefinition<Attributes>;

  constructor(definition: FactoryDefinition<Attributes> = {}) {
    this.#definition = definition;
  }

  /**
   * Evaluate this factory for one model.
   */
  build(
    sequence: number,
    traitNames: readonly string[] = [],
    overrides: Readonly<Record<string, unknown>> = {},
  ): FactoryBuild<Attributes> {
    const definitions = [this.#definition];

    for (const name of traitNames) {
      const selected = this.#definition[name];

      if (!isFactoryTrait(selected)) {
        throw new Error(`Factory does not define a "${name}" trait.`);
      }

      definitions.push(selected[TRAIT] as FactoryDefinition<Attributes>);
    }

    const attributes: Record<string, unknown> = { ...overrides };

    for (const definition of definitions) {
      for (const [name, value] of Object.entries(definition)) {
        if (isFactoryTrait(value) || Object.prototype.hasOwnProperty.call(overrides, name)) {
          continue;
        }

        attributes[name] =
          typeof value === "function" ? Reflect.apply(value, attributes, [sequence]) : value;
      }
    }

    return {
      attributes: attributes as Partial<Attributes> & Record<string, unknown>,
    };
  }
}

/**
 * Group factory attributes under a reusable name.
 */
export function trait<Attributes extends object>(
  definition: FactoryDefinition<Attributes>,
): FactoryTrait<Attributes> {
  return { [TRAIT]: definition };
}

function isFactoryTrait(value: unknown): value is FactoryTrait {
  return typeof value === "object" && value !== null && TRAIT in value;
}
