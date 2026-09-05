import type { KajoSchema } from "../../../../src/index.ts";

export type SchemaName = "arktype" | "valibot" | "zod";
export type TaskStatus = "backlog" | "in-progress" | "done";

export interface Task {
  status: TaskStatus;
  title: string;
}

export interface User {
  name: string;
}

export interface CreateTaskRequest {
  task: {
    assigneeId: string;
    status: TaskStatus;
    title: string;
  };
}

export interface UpdateTaskRequest {
  task: {
    status: TaskStatus;
  };
}

export interface TaskResponse {
  task: Task & {
    assigneeId: string;
    id: string;
  };
  users: (User & { id: string })[];
}

export interface TasksResponse {
  tasks: (Task & {
    assigneeId: string;
    id: string;
  })[];
  users: (User & { id: string })[];
}

export interface Summary {
  done: number;
  open: number;
  total: number;
}

export interface TaskBoardSchemas {
  readonly createTaskRequest: KajoSchema<unknown, CreateTaskRequest>;
  readonly id: KajoSchema<unknown, string>;
  readonly summary: KajoSchema<unknown, Summary>;
  readonly task: KajoSchema<unknown, Task>;
  readonly taskResponse: KajoSchema<unknown, TaskResponse>;
  readonly tasksResponse: KajoSchema<unknown, TasksResponse>;
  readonly updateTaskRequest: KajoSchema<unknown, UpdateTaskRequest>;
  readonly user: KajoSchema<unknown, User>;
}
