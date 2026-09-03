/// <reference lib="dom" />

import { expect, test } from "vite-plus/test";
import { createServer } from "../../src/index.ts";

test("intercepts Fetch and XMLHttpRequest in a real browser", async () => {
  const server = createServer({
    routes() {
      this.namespace = "/api";
      this.get("/fetch/:id", (_schema, request) => ({
        id: request.params.id,
        transport: "fetch",
      }));
      this.post("/xhr", (_schema, request) => ({
        body: JSON.parse(request.requestBody),
        transport: "xhr",
      }));
    },
  });

  try {
    const fetchResponse = await fetch("/api/fetch/task%201");
    await expect(fetchResponse.json()).resolves.toEqual({
      id: "task 1",
      transport: "fetch",
    });

    const xhrResponse = await sendXmlHttpRequest("/api/xhr", {
      status: "done",
    });
    expect(xhrResponse.status).toBe(200);
    expect(JSON.parse(xhrResponse.body)).toEqual({
      body: { status: "done" },
      transport: "xhr",
    });
  } finally {
    server.shutdown();
  }
});

function sendXmlHttpRequest(
  url: string,
  body: unknown,
): Promise<{ readonly body: string; readonly status: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.setRequestHeader("content-type", "application/json");
    request.addEventListener("load", () => {
      resolve({
        body: request.responseText,
        status: request.status,
      });
    });
    request.addEventListener("error", () => {
      reject(new Error(`XMLHttpRequest to ${url} failed.`));
    });
    request.send(JSON.stringify(body));
  });
}
