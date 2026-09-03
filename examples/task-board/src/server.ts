import { belongsTo, createServer, hasMany, model, Serializer } from "@cahva/kajo";

export type TaskStatus = "backlog" | "in-progress" | "done";

interface Task {
  status: TaskStatus;
  title: string;
}

interface User {
  name: string;
}

export const server = createServer({
  models: {
    task: model<Task>().extend({
      assignee: belongsTo("user"),
    }),
    user: model<User>().extend({
      tasks: hasMany("task"),
    }),
  },

  serializers: {
    task: Serializer.extend({
      include: ["assignee"],
    }),
  },

  seeds(server) {
    const ada = server.schema.users.create({ name: "Ada" });
    const linus = server.schema.users.create({ name: "Linus" });
    const margaret = server.schema.users.create({ name: "Margaret" });

    server.schema.tasks.create({
      assignee: margaret,
      status: "backlog",
      title: "Design empty states",
    });
    server.schema.tasks.create({
      assignee: ada,
      status: "in-progress",
      title: "Model task relationships",
    });
    server.schema.tasks.create({
      assignee: linus,
      status: "done",
      title: "Wire up request interception",
    });
  },

  routes() {
    this.namespace = "/api";

    this.get("/tasks");
    this.post("/tasks");
    this.patch("/tasks/:id");
    this.del("/tasks/:id");

    this.get("/summary", (schema) => {
      const tasks = schema.tasks.all().models;

      return {
        done: tasks.filter((task) => task.status === "done").length,
        open: tasks.filter((task) => task.status !== "done").length,
        total: tasks.length,
      };
    });
  },
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => server.shutdown());
}
