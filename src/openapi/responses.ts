import { mediaTypePriority, serializeExampleBody } from "./media-types.ts";
import { LocalReferenceResolver } from "./references.ts";
import { generateSchemaValue } from "./schema-generation.ts";
import type {
  OpenApiExample,
  OpenApiMediaType,
  OpenApiMethod,
  OpenApiOperation,
  OpenApiReference,
  OpenApiResponse,
} from "./types.ts";

export function exampleResponse(
  operation: OpenApiOperation,
  identity: string,
  references: LocalReferenceResolver,
  method: OpenApiMethod,
): Response {
  if (!operation.responses || typeof operation.responses !== "object") {
    throw new TypeError(
      `OpenAPI operation "${operation.operationId ?? identity}" has no responses.`,
    );
  }

  const selected = selectResponse(operation.responses);

  if (!selected) {
    throw new TypeError(
      `OpenAPI operation "${operation.operationId ?? identity}" has no successful response.`,
    );
  }

  const response = references.resolve(
    selected.response,
    `response for "${operation.operationId ?? identity}"`,
  ) as OpenApiResponse;
  const media = selectMediaType(response.content);
  const body =
    method === "HEAD"
      ? undefined
      : media
        ? selectExample(media.value, operation.operationId ?? identity, references)
        : undefined;

  if (method === "HEAD") {
    return new Response(null, {
      headers: media ? { "content-type": media.type } : undefined,
      status: selected.status,
    });
  }

  if (selected.status === 204 || body === undefined) {
    return new Response(null, { status: selected.status });
  }

  return new Response(serializeExampleBody(body, media?.type, operation.operationId ?? identity), {
    headers: media ? { "content-type": media.type } : undefined,
    status: selected.status,
  });
}

function selectResponse(
  responses: OpenApiOperation["responses"],
): { readonly response: OpenApiResponse | OpenApiReference; readonly status: number } | undefined {
  const concrete = Object.entries(responses)
    .filter(
      (entry): entry is [string, OpenApiResponse | OpenApiReference] =>
        entry[1] !== undefined && /^2\d{2}$/.test(entry[0]),
    )
    .sort(([left], [right]) => Number(left) - Number(right))[0];

  if (concrete) {
    return { response: concrete[1], status: Number(concrete[0]) };
  }

  const wildcard = responses["2XX"];

  if (wildcard) {
    return { response: wildcard, status: 200 };
  }

  const fallback = responses.default;

  if (fallback) {
    return { response: fallback, status: 200 };
  }

  const documented = Object.entries(responses)
    .filter(
      (entry): entry is [string, OpenApiResponse | OpenApiReference] =>
        entry[1] !== undefined && /^[1-5]\d{2}$/.test(entry[0]),
    )
    .sort(([left], [right]) => Number(left) - Number(right))[0];

  return documented ? { response: documented[1], status: Number(documented[0]) } : undefined;
}

function selectMediaType(
  content: OpenApiResponse["content"],
): { readonly type: string; readonly value: OpenApiMediaType } | undefined {
  const selected = Object.entries(content ?? {})
    .filter((entry): entry is [string, OpenApiMediaType] => entry[1] !== undefined)
    .sort(([left], [right]) => mediaTypePriority(left) - mediaTypePriority(right))[0];

  return selected ? { type: selected[0], value: selected[1] } : undefined;
}

function selectExample(
  mediaType: OpenApiMediaType,
  operation: string,
  references: LocalReferenceResolver,
): unknown {
  if (Object.prototype.hasOwnProperty.call(mediaType, "example")) {
    return mediaType.example;
  }

  for (const [name, candidate] of Object.entries(mediaType.examples ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!candidate) {
      continue;
    }

    const example = references.resolve(
      candidate,
      `example "${name}" for "${operation}"`,
    ) as OpenApiExample;

    if (Object.prototype.hasOwnProperty.call(example, "value")) {
      return example.value;
    }
  }

  if (mediaType.schema === undefined) {
    return undefined;
  }

  return generateSchemaValue(mediaType.schema, operation, references, new Set());
}
