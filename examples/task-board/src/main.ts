import "./style.css";
import {
  createTask,
  deleteTask,
  getBoard,
  updateTask,
  type ApiTask,
  type ApiUser,
  type Summary,
} from "./api.ts";
import { schemaName } from "./server.ts";
import type { TaskStatus } from "./schemas/types.ts";

const statuses: readonly { label: string; value: TaskStatus }[] = [
  { label: "Backlog", value: "backlog" },
  { label: "In progress", value: "in-progress" },
  { label: "Done", value: "done" },
];

const board = requiredElement("board");
const summary = requiredElement("summary");
const form = requiredElement<HTMLFormElement>("task-form");
const assignee = requiredElement<HTMLSelectElement>("assignee");
const schemaImplementation = requiredElement("schema-implementation");

schemaImplementation.replaceChildren(
  ...(["zod", "valibot", "arktype"] as const).map((name) => {
    const link = document.createElement("a");
    link.href = `?schema=${name}`;
    link.textContent = name === "arktype" ? "ArkType" : `${name[0]!.toUpperCase()}${name.slice(1)}`;

    if (name === schemaName) {
      link.ariaCurrent = "page";
    }

    return link;
  }),
);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);

  void runMutation(async () => {
    await createTask({
      assigneeId: formValue(data, "assigneeId"),
      title: formValue(data, "title"),
    });
    form.reset();
  });
});

void refresh();

async function refresh(): Promise<void> {
  setBusy(true);

  try {
    const data = await getBoard();
    renderAssignees(data.users);
    renderSummary(data.summary);
    renderBoard(data.tasks, data.users);
  } catch (error) {
    board.replaceChildren(message(error instanceof Error ? error.message : "Unknown error", true));
  } finally {
    setBusy(false);
  }
}

function renderAssignees(users: ApiUser[]): void {
  const selected = assignee.value;
  assignee.replaceChildren(
    ...users.map((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name;
      return option;
    }),
  );
  assignee.value = selected || users[0]?.id || "";
}

function renderSummary(data: Summary): void {
  summary.replaceChildren(
    metric(String(data.total), "Total tasks"),
    metric(String(data.open), "Still open"),
    metric(String(data.done), "Completed"),
  );
}

function renderBoard(tasks: ApiTask[], users: ApiUser[]): void {
  const usersById = new Map(users.map((user) => [user.id, user]));

  board.replaceChildren(
    ...statuses.map((status) => {
      const matchingTasks = tasks.filter((task) => task.status === status.value);
      const column = element("section", "column");
      const heading = element("header", "column-heading");
      const title = document.createElement("h2");
      title.textContent = status.label;
      const count = element("span", "count");
      count.textContent = String(matchingTasks.length);
      heading.append(title, count);

      const cards = element("div", "cards");
      cards.append(
        ...(matchingTasks.length
          ? matchingTasks.map((task) => taskCard(task, usersById.get(task.assigneeId)))
          : [message("Nothing here yet.")]),
      );
      column.append(heading, cards);
      return column;
    }),
  );
}

function taskCard(task: ApiTask, user: ApiUser | undefined): HTMLElement {
  const card = element("article", "task");
  const title = document.createElement("h3");
  title.textContent = task.title;

  const meta = element("div", "task-meta");
  const avatar = element("span", "avatar");
  avatar.textContent = initials(user?.name ?? "?");
  avatar.title = user?.name ?? "Unassigned";
  const person = document.createElement("span");
  person.textContent = user?.name ?? "Unassigned";
  meta.append(avatar, person);

  const actions = element("div", "task-actions");
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Status for ${task.title}`);
  select.append(
    ...statuses.map((status) => {
      const option = document.createElement("option");
      option.value = status.value;
      option.textContent = status.label;
      option.selected = status.value === task.status;
      return option;
    }),
  );
  select.addEventListener("change", () => {
    void runMutation(() => updateTask(task.id, select.value as TaskStatus));
  });

  const remove = element("button", "remove");
  remove.type = "button";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => {
    void runMutation(() => deleteTask(task.id));
  });

  actions.append(select, remove);
  card.append(title, meta, actions);
  return card;
}

async function runMutation(mutation: () => Promise<unknown>): Promise<void> {
  setBusy(true);

  try {
    await mutation();
    await refresh();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "The request failed.");
    setBusy(false);
  }
}

function setBusy(busy: boolean): void {
  form.toggleAttribute("aria-busy", busy);
  for (const control of document.querySelectorAll("button, select, input")) {
    (control as HTMLButtonElement).disabled = busy;
  }
}

function metric(value: string, label: string): HTMLElement {
  const item = element("div", "metric");
  const amount = document.createElement("strong");
  amount.textContent = value;
  const description = document.createElement("span");
  description.textContent = label;
  item.append(amount, description);
  return item;
}

function message(text: string, error = false): HTMLElement {
  const item = element("p", error ? "message error" : "message");
  item.textContent = text;
  return item;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className: string,
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function requiredElement<ElementType extends HTMLElement = HTMLElement>(id: string): ElementType {
  const node = document.querySelector<ElementType>(`#${id}`);

  if (!node) {
    throw new Error(`Missing required element "#${id}".`);
  }

  return node;
}

function formValue(data: FormData, name: string): string {
  const value = data.get(name);

  if (typeof value !== "string") {
    throw new TypeError(`The "${name}" form field must be text.`);
  }

  return value;
}
