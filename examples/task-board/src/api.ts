import type { Summary, TaskStatus } from "./schemas/types.ts";

export type { Summary } from "./schemas/types.ts";

export interface ApiUser {
  id: string;
  name: string;
}

export interface ApiTask {
  assigneeId: string;
  id: string;
  status: TaskStatus;
  title: string;
}

interface TaskPayload {
  task: ApiTask;
  users: ApiUser[];
}

interface TasksPayload {
  tasks: ApiTask[];
  users: ApiUser[];
}

export async function getBoard(): Promise<{
  summary: Summary;
  tasks: ApiTask[];
  users: ApiUser[];
}> {
  const [board, summary] = await Promise.all([
    request<TasksPayload>("/api/tasks"),
    request<Summary>("/api/summary"),
  ]);

  return { ...board, summary };
}

export async function createTask(input: {
  assigneeId: string;
  title: string;
}): Promise<TaskPayload> {
  return request("/api/tasks", {
    body: JSON.stringify({
      task: {
        ...input,
        status: "backlog",
      },
    }),
    method: "POST",
  });
}

export async function updateTask(id: string, status: TaskStatus): Promise<TaskPayload> {
  return request(`/api/tasks/${id}`, {
    body: JSON.stringify({ task: { status } }),
    method: "PATCH",
  });
}

export async function deleteTask(id: string): Promise<void> {
  await request(`/api/tasks/${id}`, { method: "DELETE" });
}

async function request<Result>(path: string, init?: RequestInit): Promise<Result> {
  const response = await fetch(path, {
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    ...init,
  });

  if (!response.ok) {
    const details = await response
      .clone()
      .json()
      .catch(() => undefined);
    const issues =
      typeof details === "object" &&
      details !== null &&
      Array.isArray(Reflect.get(details, "issues"))
        ? (Reflect.get(details, "issues") as { message?: unknown }[])
        : [];
    const message = issues
      .map(({ message }) => (typeof message === "string" ? message : undefined))
      .filter(Boolean)
      .join(" ");

    throw new Error(message || `Request failed with ${response.status} ${response.statusText}`);
  }

  return response.body ? (response.json() as Promise<Result>) : (undefined as Result);
}
