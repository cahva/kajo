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

export interface TaskBoardSchemas {
  readonly task: KajoSchema<unknown, Task>;
  readonly user: KajoSchema<unknown, User>;
}
