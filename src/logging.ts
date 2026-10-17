/** Fields shared by every request log entry. */
export interface RequestLogBase {
  /** The original platform request. */
  readonly request: Request;
  /** The request method, normalized to uppercase. */
  readonly method: string;
  /** The full request URL. */
  readonly url: string;
}

/** A request answered by a Kajo route. */
export interface HandledRequestLog extends RequestLogBase {
  /** The entry kind. */
  readonly type: "handled";
  /** Time spent resolving the route and applying its configured delay. */
  readonly durationMs: number;
  /** The raw request body. */
  readonly requestBody: string;
  /** Dynamic path parameters matched by the route. */
  readonly params: Readonly<Record<string, string>>;
  /** Parsed query string values. */
  readonly queryParams: Readonly<Record<string, string>>;
  /** The response returned by Kajo. */
  readonly response: Response;
  /** The route pattern that handled the request. */
  readonly route: string;
}

/** A request Kajo let through to the network. */
export interface PassthroughRequestLog extends RequestLogBase {
  /** The entry kind. */
  readonly type: "passthrough";
  /** Why Kajo allowed the request to reach the network. */
  readonly reason: "policy" | "rule";
}

/** A request Kajo owns but no route matched, under the `"error"` unhandled-request policy. */
export interface UnhandledRequestLog extends RequestLogBase {
  /** The entry kind. */
  readonly type: "unhandled";
}

/** A request whose route handler threw an unexpected error. */
export interface ErroredRequestLog extends RequestLogBase {
  /** The entry kind. */
  readonly type: "error";
  /** Time spent before the handler failed. */
  readonly durationMs: number;
  /** The error the handler threw. */
  readonly error: unknown;
  /** The raw request body. */
  readonly requestBody: string;
  /** Dynamic path parameters matched by the route. */
  readonly params: Readonly<Record<string, string>>;
  /** Parsed query string values. */
  readonly queryParams: Readonly<Record<string, string>>;
  /** The route pattern whose handler failed. */
  readonly route: string;
}

/**
 * Diagnostic information emitted while Kajo routes a request.
 */
export type RequestLog =
  | ErroredRequestLog
  | HandledRequestLog
  | PassthroughRequestLog
  | UnhandledRequestLog;

/** A callback that receives every request log entry. */
export type RequestLogger = (entry: RequestLog) => void;

/**
 * A {@linkcode RequestLogger} that writes entries to the console. Handled
 * requests appear as collapsed groups with the request, response, parameters,
 * and body.
 */
export function logRequestToConsole(entry: RequestLog): void {
  if (entry.type === "passthrough") {
    console.debug(
      `[Kajo] Passthrough ${entry.method} ${entry.url} (${entry.reason})`,
      entry.request,
    );
    return;
  }

  if (entry.type === "unhandled") {
    console.error(`[Kajo] Unhandled ${entry.method} ${entry.url}`, entry.request);
    return;
  }

  if (entry.type === "error") {
    console.error(
      `[Kajo] Error ${entry.method} ${entry.url} → ${entry.route} (${formatDuration(entry.durationMs)})`,
      entry.error,
      entry.request,
    );
    logRequestData(entry);
    return;
  }

  console.groupCollapsed(
    `[Kajo] ${entry.response.status} ${entry.method} ${entry.url} → ${entry.route} (${formatDuration(entry.durationMs)})`,
  );
  console.log("Response", entry.response);
  logRequestData(entry);
  console.log("Request", entry.request);
  console.groupEnd();
}

function logRequestData(entry: HandledRequestLog | ErroredRequestLog): void {
  if (Object.keys(entry.params).length > 0) {
    console.log("Path parameters", entry.params);
  }

  if (Object.keys(entry.queryParams).length > 0) {
    console.log("Query parameters", entry.queryParams);
  }

  if (entry.requestBody) {
    console.log("Request body", formatBody(entry.requestBody));
  }
}

function formatBody(body: string): unknown {
  if (!body) {
    return "(empty)";
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function formatDuration(durationMs: number): string {
  return `${durationMs.toFixed(1)}ms`;
}
