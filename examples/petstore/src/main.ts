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
type Payload = Pet | Order | FindPetsResponse | InventoryResponse;

interface ApiResult<Body = Payload> {
  body: Body;
  status: number;
  statusText: string;
}

const result = requiredElement("result");
const resultTitle = requiredElement("result-title");
const mode = requiredElement("mode");
const form = requiredElement<HTMLFormElement>("pet-form");
const petLookup = requiredElement<HTMLFormElement>("pet-lookup");
const petIdInput = requiredElement<HTMLInputElement>("pet-id");
const resultMethod = requiredElement("result-method");
const resultPath = requiredElement("result-path");
const resultStatus = requiredElement("result-status");
const resultPreview = requiredElement("result-preview");
const operations = [...document.querySelectorAll<HTMLElement>("[data-operation]")];

requiredElement("available").addEventListener("click", (event) => {
  void show(
    event,
    "Available pets",
    "Implemented",
    "GET",
    "/v2/pet/findByStatus?status=available",
    () => request<FindPetsResponse>("/v2/pet/findByStatus?status=available"),
  );
});
petLookup.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = petIdInput.value;
  const path = `/v2/pet/${encodeURIComponent(id)}`;
  void show(event, `Pet ${id}`, "Implemented", "GET", path, () => request<GetPetResponse>(path));
});
requiredElement("order").addEventListener("click", (event) => {
  void show(event, "Order 1", "Implemented", "GET", "/v2/store/order/1", () =>
    request<GetOrderResponse>("/v2/store/order/1"),
  );
});
requiredElement("inventory").addEventListener("click", (event) => {
  void show(event, "Inventory", "Generated", "GET", "/v2/store/inventory", () =>
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
  void show(event, "Created pet", "Implemented", "POST", "/v2/pet", async () => {
    const response = await request<Pet>("/v2/pet", {
      body: JSON.stringify(pet),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (response.body.id !== undefined) {
      petIdInput.value = String(response.body.id);
    }

    return response;
  });
});

void show(
  undefined,
  "Available pets",
  "Implemented",
  "GET",
  "/v2/pet/findByStatus?status=available",
  () => request<FindPetsResponse>("/v2/pet/findByStatus?status=available"),
);

async function show(
  event: Event | undefined,
  title: string,
  behavior: string,
  method: "GET" | "POST",
  path: string,
  load: () => Promise<ApiResult>,
): Promise<void> {
  const selected = event?.currentTarget;
  const selectedOperation =
    selected instanceof HTMLElement
      ? selected
      : event === undefined
        ? requiredElement("available")
        : undefined;
  operations.forEach((operation) =>
    operation.classList.toggle("active", operation === selectedOperation),
  );
  resultTitle.textContent = title;
  mode.textContent = behavior;
  mode.classList.toggle("generated", behavior === "Generated");
  resultMethod.textContent = method;
  resultMethod.className = `method ${method.toLowerCase()}`;
  resultPath.textContent = path;
  resultStatus.textContent = "Waiting…";
  resultPreview.replaceChildren(emptyState("Sending request to Kajo…"));
  result.textContent = "Loading…";

  try {
    const response = await load();
    resultStatus.textContent = `${response.status} ${response.statusText}`;
    resultPreview.replaceChildren(...preview(response.body, behavior === "Generated"));
    result.textContent = JSON.stringify(response.body, null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    resultStatus.textContent = "Request failed";
    resultPreview.replaceChildren(emptyState(message));
    result.textContent = message;
  }
}

async function request<ResponseBody>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<ResponseBody>> {
  const response = await fetch(path, init);

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return {
    body: (await response.json()) as ResponseBody,
    status: response.status,
    statusText: response.statusText || statusText(response.status),
  };
}

function statusText(status: number): string {
  return (
    {
      200: "OK",
      201: "Created",
      204: "No Content",
    }[status] ?? ""
  );
}

function preview(value: unknown, generated: boolean): HTMLElement[] {
  if (Array.isArray(value)) {
    return value.length > 0
      ? value.map((entry) => entityCard(entry))
      : [emptyState("The operation returned an empty collection.")];
  }

  if (typeof value === "object" && value !== null && Object.keys(value).length > 0) {
    return [entityCard(value)];
  }

  return [
    emptyState(
      generated
        ? "This operation has no handler. Kajo synthesized this empty object from Petstore's inventory schema."
        : "The operation completed without response fields.",
    ),
  ];
}

function entityCard(value: unknown): HTMLElement {
  const card = element("article", "entity-card");

  if (typeof value !== "object" || value === null) {
    card.append(elementWithText("strong", String(value)));
    return card;
  }

  const name = Reflect.get(value, "name");
  const id = Reflect.get(value, "id");
  const status = Reflect.get(value, "status");
  const petId = Reflect.get(value, "petId");
  card.append(
    elementWithText(
      "strong",
      typeof name === "string" ? name : petId !== undefined ? `Order #${String(id)}` : "Response",
    ),
  );

  if (id !== undefined) {
    card.append(elementWithText("span", `ID ${String(id)}`));
  }

  if (petId !== undefined) {
    card.append(elementWithText("span", `Pet ${String(petId)}`));
  }

  if (typeof status === "string") {
    card.append(elementWithText("span", status, "entity-status"));
  }

  return card;
}

function emptyState(message: string): HTMLElement {
  return elementWithText("div", message, "empty-state");
}

function elementWithText<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  text: string,
  className?: string,
): HTMLElementTagNameMap[Tag] {
  const node = element(tag, className);
  node.textContent = text;
  return node;
}

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className?: string,
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

function requiredElement<ElementType extends HTMLElement = HTMLElement>(id: string): ElementType {
  const element = document.querySelector<ElementType>(`#${id}`);

  if (!element) {
    throw new Error(`Missing #${id} element.`);
  }

  return element;
}
