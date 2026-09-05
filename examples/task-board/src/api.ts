import type { TaskStatus } from "./schemas/types.ts";

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

export interface Summary {
  done: number;
  open: number;
  total: number;
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
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return response.body ? (response.json() as Promise<Result>) : (undefined as Result);
}
