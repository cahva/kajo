import petstore from "@readme/oas-examples/3.1/json/petstore.json" with { type: "json" };
import {
  createServer,
  HttpError,
  model,
  Serializer,
  type OpenApiDocument,
} from "../../../src/index.ts";
import { createAjvOpenApiValidator } from "../../../src/openapi/ajv.ts";
import type { components, operations } from "./petstore.generated.ts";

type Pet = components["schemas"]["Pet"];
type PetAttributes = Omit<Pet, "id">;
type Order = components["schemas"]["Order"];
type OrderAttributes = Omit<Order, "id">;
type PetStatus = NonNullable<Pet["status"]>;
type AddPetBody = operations["addPet"]["requestBody"]["content"]["application/json"];
type PlaceOrderBody = operations["placeOrder"]["requestBody"]["content"]["application/json"];

const models = {
  order: model<OrderAttributes>(),
  pet: model<PetAttributes>(),
};

export const server = createServer({
  intercept: true,
  logging: true,
  models,
  openapi: petstore as unknown as OpenApiDocument,
  openapiHandlers: {
    addPet: (schema, request) => {
      const { id, ...attributes } = JSON.parse(request.requestBody) as AddPetBody;
      return schema.pets.create({ ...attributes, id });
    },
    deletePet: (schema, request) => {
      const petId = request.params.petId;
      const pet = petId ? schema.pets.find(petId) : null;

      if (!pet) {
        throw new HttpError(404, `Pet "${petId}" was not found.`);
      }

      pet.destroy();
      return new Response(null, { status: 204 });
    },
    findPetsByStatus: (schema, request) => {
      const statuses = new Set(
        new URL(request.url).searchParams
          .getAll("status")
          .flatMap((value) => value.split(",")) as PetStatus[],
      );
      return schema.pets
        .all()
        .filter((pet) => pet.status !== undefined && statuses.has(pet.status));
    },
    getOrderById: (schema, request) => {
      const orderId = request.params.orderId;
      const order = orderId ? schema.orders.find(orderId) : null;

      if (!order) {
        throw new HttpError(404, `Order "${orderId}" was not found.`);
      }

      return order;
    },
    getPetById: (schema, request) => {
      const petId = request.params.petId;
      const pet = petId ? schema.pets.find(petId) : null;

      if (!pet) {
        throw new HttpError(404, `Pet "${petId}" was not found.`);
      }

      return pet;
    },
    placeOrder: (schema, request) => {
      const { id, ...attributes } = JSON.parse(request.requestBody) as PlaceOrderBody;
      return schema.orders.create({ ...attributes, id });
    },
  },
  openapiValidator: createAjvOpenApiValidator(),
  serializers: {
    application: Serializer.extend({ root: false }),
  },
  seeds(server) {
    server.schema.pets.create({
      id: 1,
      name: "Kajo",
      photoUrls: ["https://example.test/kajo.jpg"],
      status: "available",
      tags: [{ id: 1, name: "mocked" }],
    });
    server.schema.pets.create({
      id: 2,
      name: "Sisu",
      photoUrls: ["https://example.test/sisu.jpg"],
      status: "pending",
    });
    server.schema.orders.create({
      complete: false,
      id: 1,
      petId: 1,
      quantity: 1,
      shipDate: "2026-09-06T09:00:00Z",
      status: "placed",
    });
  },
  urlPrefix: `${window.location.origin}/v2`,
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => server.shutdown());
}
