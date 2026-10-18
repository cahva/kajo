import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createServer, model, type WebSocketRoute } from "../src/index.ts";

const kajoServers: { shutdown(): void }[] = [];

afterEach(() => {
  for (const server of kajoServers.splice(0)) {
    server.shutdown();
  }
});

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.addEventListener("message", (event) => resolve(event.data), { once: true });
  });
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
}

describe("websocket routes", () => {
  test("handles matching connections with params and schema", async () => {
    const server = createServer({
      models: { room: model<{ name: string }>() },
      routes() {
        this.websocket("/rooms/:id", (client, { params, schema }) => {
          const room = schema.rooms.find(params.id);
          client.send(`joined ${room?.name}`);
          client.addEventListener("message", (event) =>
            client.send(`echo ${event.data as string}`),
          );
        });
      },
      seeds(server) {
        server.schema.rooms.create({ name: "lobby" });
      },
      urlPrefix: "https://api.example.test",
    });
    kajoServers.push(server);

    const socket = new WebSocket("wss://api.example.test/rooms/1");

    await expect(nextMessage(socket)).resolves.toBe("joined lobby");
    socket.send("hi");
    await expect(nextMessage(socket)).resolves.toBe("echo hi");
    socket.close();
  });

  test("broadcasts to every client on a route", async () => {
    let feed: WebSocketRoute | undefined;
    const server = createServer({
      routes() {
        feed = this.websocket("/feed", () => {});
        this.websocket("/other", (client) => {
          client.addEventListener("message", () => client.send("other"));
        });
      },
      urlPrefix: "http://api.example.test",
    });
    kajoServers.push(server);

    const first = new WebSocket("ws://api.example.test/feed");
    const second = new WebSocket("ws://api.example.test/feed");
    const other = new WebSocket("ws://api.example.test/other");
    await Promise.all([opened(first), opened(second), opened(other)]);

    const messages = Promise.all([nextMessage(first), nextMessage(second)]);
    const otherMessage = nextMessage(other);
    feed?.broadcast("update");
    other.send("ping");

    await expect(messages).resolves.toEqual(["update", "update"]);
    await expect(otherMessage).resolves.toBe("other");
  });

  test("broadcasts to a route registered under an earlier namespace", async () => {
    let feed: WebSocketRoute | undefined;
    const server = createServer({
      routes() {
        this.namespace = "v1";
        feed = this.websocket("/feed", () => {});
        this.namespace = "v2";
      },
      urlPrefix: "http://api.example.test",
    });
    kajoServers.push(server);

    const socket = new WebSocket("ws://api.example.test/v1/feed");
    await opened(socket);
    const message = nextMessage(socket);
    feed?.broadcast("update");

    await expect(message).resolves.toBe("update");
  });

  test("closes the client with 1011 when the handler throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = createServer({
      routes() {
        this.websocket("/boom", () => {
          throw new Error("boom");
        });
      },
      urlPrefix: "http://api.example.test",
    });
    kajoServers.push(server);

    const socket = new WebSocket("ws://api.example.test/boom");
    const closed = new Promise<CloseEvent>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event)),
    );

    await expect(closed).resolves.toMatchObject({ code: 1011 });
    expect(error).toHaveBeenCalledWith(
      '[Kajo] WebSocket handler for "/boom" failed.',
      expect.any(Error),
    );
    error.mockRestore();
  });

  test("passes unmatched connections through to the network", async () => {
    const server = createServer({
      routes() {
        this.websocket("/feed", () => {});
      },
      urlPrefix: "http://api.example.test",
    });
    kajoServers.push(server);

    // Nothing listens on port 1, so a real connection attempt fails.
    const socket = new WebSocket("ws://127.0.0.1:1/other");
    await expect(
      new Promise((resolve) => socket.addEventListener("close", () => resolve("closed"))),
    ).resolves.toBe("closed");
  });

  test("closes clients on shutdown", async () => {
    const server = createServer({
      routes() {
        this.websocket("/feed", () => {});
      },
      urlPrefix: "http://api.example.test",
    });

    const socket = new WebSocket("ws://api.example.test/feed");
    await opened(socket);
    const closed = new Promise((resolve) => socket.addEventListener("close", resolve));
    server.shutdown();

    await expect(closed).resolves.toBeDefined();
  });
});
