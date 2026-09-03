export interface RequestLogBase {
  /** The original platform request. */
  readonly request: Request;
  /** The request method, normalized to uppercase. */
  readonly method: string;
  /** The full request URL. */
  readonly url: string;
}

export interface HandledRequestLog extends RequestLogBase {
  readonly type: "handled";
  /** Time spent resolving the route and applying its configured delay. */
  readonly durationMs: number;
  /** The raw request body. */
  readonly requestBody: string;
  /** The response returned by Kajo. */
  readonly response: Response;
  /** The route pattern that handled the request. */
  readonly route: string;
}

export interface PassthroughRequestLog extends RequestLogBase {
  readonly type: "passthrough";
  /** Why Kajo allowed the request to reach the network. */
  readonly reason: "policy" | "rule";
}

export interface UnhandledRequestLog extends RequestLogBase {
  readonly type: "unhandled";
}

export interface ErroredRequestLog extends RequestLogBase {
  readonly type: "error";
  readonly durationMs: number;
  readonly error: unknown;
  /** The raw request body. */
  readonly requestBody: string;
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

export type RequestLogger = (entry: RequestLog) => void;

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
    console.log("Request body", formatBody(entry.requestBody));
    return;
  }

  console.groupCollapsed(
    `[Kajo] ${entry.response.status} ${entry.method} ${entry.url} → ${entry.route} (${formatDuration(entry.durationMs)})`,
  );
  console.log("Response", entry.response);
  console.log("Request body", formatBody(entry.requestBody));
  console.log("Request", entry.request);
  console.groupEnd();
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
