import { WebSocketInterceptor } from "@mswjs/interceptors/WebSocket";

/** Data that can be sent over a WebSocket connection. */
export type WebSocketData = string | ArrayBuffer | Blob | ArrayBufferView<ArrayBuffer>;

/** A message received over a WebSocket connection. */
export interface WebSocketMessageEvent {
  /** The message payload. */
  readonly data: WebSocketData;
  /**
   * Stop the default handling. For a message from the real server, this keeps
   * it from being forwarded to the client.
   */
  preventDefault(): void;
}

/** The closing of a WebSocket connection. */
export interface WebSocketCloseEvent {
  /** The close code. */
  readonly code: number;
  /** The close reason. */
  readonly reason: string;
  /** Whether the connection closed cleanly. */
  readonly wasClean: boolean;
}

/** The client side of an intercepted WebSocket connection. */
export interface WebSocketClient {
  /** A unique ID for this connection. */
  readonly id: string;
  /** The URL the client connected to. */
  readonly url: URL;
  /** Send data to the client. */
  send(data: WebSocketData): void;
  /** Close the connection with an optional code and reason. */
  close(code?: number, reason?: string): void;
  /** Listen for messages the client sends. */
  addEventListener(type: "message", listener: (event: WebSocketMessageEvent) => void): void;
  /** Listen for the connection closing. */
  addEventListener(type: "close", listener: (event: WebSocketCloseEvent) => void): void;
}

/**
 * The real server behind an intercepted WebSocket connection. Nothing reaches
 * the network until {@linkcode WebSocketServer.connect} is called.
 */
export interface WebSocketServer {
  /**
   * Open the real connection. Messages then flow between the client and the
   * server unless a listener calls `preventDefault()`.
   */
  connect(): void;
  /** Send data to the real server. */
  send(data: WebSocketData): void;
  /** Close the real connection. */
  close(): void;
  /** Listen for the real connection opening. */
  addEventListener(type: "open", listener: () => void): void;
  /** Listen for messages from the real server. */
  addEventListener(type: "message", listener: (event: WebSocketMessageEvent) => void): void;
  /** Listen for the real connection closing. */
  addEventListener(type: "close", listener: (event: WebSocketCloseEvent) => void): void;
  /** Listen for real connection errors. */
  addEventListener(type: "error", listener: () => void): void;
}

/** Information about an intercepted WebSocket connection. */
export interface WebSocketRouteContext<Schema = unknown> {
  /** Path parameters from the matched route. */
  readonly params: Readonly<Record<string, string>>;
  /** The URL the client connected to. */
  readonly url: URL;
  /** The server's schema, for reading and writing mocked data. */
  readonly schema: Schema;
  /**
   * The real server connection. Call `server.connect()` to forward the
   * connection to the network instead of mocking it.
   */
  readonly server: WebSocketServer;
}

/**
 * Handle one intercepted WebSocket connection. Use `client.send()` to push
 * data and `client.addEventListener("message", ...)` to read what the client
 * sends.
 */
export type WebSocketHandler<Schema = unknown> = (
  client: WebSocketClient,
  context: WebSocketRouteContext<Schema>,
) => void;

/** A registered WebSocket route, returned by `websocket()`. */
export interface WebSocketRoute {
  /** Send data to every open client connected through this route. */
  broadcast(data: WebSocketData): void;
}

export interface WebSocketConnection {
  readonly client: WebSocketClient;
  readonly server: WebSocketServer;
  readonly url: URL;
}

export function interceptWebSockets(handle: (connection: WebSocketConnection) => void): {
  dispose(): void;
} {
  const interceptor = new WebSocketInterceptor();

  interceptor.on("connection", ({ client, server }) => {
    handle({ client, server, url: httpUrl(client.url) });
  });

  interceptor.apply();

  return interceptor;
}

/** Map ws: and wss: URLs to http: and https: so they match HTTP-style route origins. */
export function httpUrl(url: URL | string): URL {
  const result = new URL(url);

  if (result.protocol === "ws:") {
    result.protocol = "http:";
  } else if (result.protocol === "wss:") {
    result.protocol = "https:";
  }

  return result;
}
