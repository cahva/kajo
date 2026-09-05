import "./server.ts";
import "./style.css";
import type { components, operations } from "./petstore.generated.ts";

type Pet = components["schemas"]["Pet"];
type Order = components["schemas"]["Order"];
type FindPetsResponse =
  operations["findPetsByStatus"]["responses"][200]["content"]["application/json"];
type GetPetResponse = operations["getPetById"]["responses"][200]["content"]["application/json"];
type GetOrderResponse = operations["getOrderById"]["responses"][200]["content"]["application/json"];
type InventoryResponse =
  operations["getInventory"]["responses"][200]["content"]["application/json"];

const result = requiredElement("result");
const resultTitle = requiredElement("result-title");
const mode = requiredElement("mode");
const form = requiredElement<HTMLFormElement>("pet-form");

requiredElement("available").addEventListener("click", () => {
  void show("Available pets", "Implemented operation", () =>
    request<FindPetsResponse>("/v2/pet/findByStatus?status=available"),
  );
});
requiredElement("pet").addEventListener("click", () => {
  void show("Pet 1", "Implemented operation", () => request<GetPetResponse>("/v2/pet/1"));
});
requiredElement("order").addEventListener("click", () => {
  void show("Order 1", "Implemented operation", () =>
    request<GetOrderResponse>("/v2/store/order/1"),
  );
});
requiredElement("inventory").addEventListener("click", () => {
  void show("Inventory", "Schema-generated fallback", () =>
    request<InventoryResponse>("/v2/store/inventory"),
  );
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const name = data.get("name");
  const pet: Pet = {
    name: typeof name === "string" ? name : "",
    photoUrls: [],
    status: "available",
  };
  void show("Created pet", "Implemented operation", () =>
    request<Pet>("/v2/pet", {
      body: JSON.stringify(pet),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
});

void show("Available pets", "Implemented operation", () =>
  request<FindPetsResponse>("/v2/pet/findByStatus?status=available"),
);

async function show(
  title: string,
  behavior: string,
  load: () => Promise<Pet | Order | FindPetsResponse | InventoryResponse>,
): Promise<void> {
  resultTitle.textContent = title;
  mode.textContent = behavior;
  result.textContent = "Loading…";

  try {
    result.textContent = JSON.stringify(await load(), null, 2);
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : "Unknown error";
  }
}

async function request<ResponseBody>(path: string, init?: RequestInit): Promise<ResponseBody> {
  const response = await fetch(path, init);

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<ResponseBody>;
}

function requiredElement<ElementType extends HTMLElement = HTMLElement>(id: string): ElementType {
  const element = document.querySelector<ElementType>(`#${id}`);

  if (!element) {
    throw new Error(`Missing #${id} element.`);
  }

  return element;
}
