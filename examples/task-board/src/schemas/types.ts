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

export interface TaskBoardSchemas {
  readonly createTaskRequest: KajoSchema<unknown, CreateTaskRequest>;
  readonly id: KajoSchema<unknown, string>;
  readonly task: KajoSchema<unknown, Task>;
  readonly taskResponse: KajoSchema<unknown, TaskResponse>;
  readonly updateTaskRequest: KajoSchema<unknown, UpdateTaskRequest>;
  readonly user: KajoSchema<unknown, User>;
}
