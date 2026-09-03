import { BatchInterceptor } from "@mswjs/interceptors";
import { FetchInterceptor } from "@mswjs/interceptors/fetch";
import { XMLHttpRequestInterceptor } from "@mswjs/interceptors/XMLHttpRequest";

export interface NetworkInterceptor {
  dispose(): void;
}

export function interceptRequests(
  handle: (request: Request) => Promise<Response | undefined>,
): NetworkInterceptor {
  const interceptor = new BatchInterceptor({
    name: "kajo",
    interceptors: [new XMLHttpRequestInterceptor(), new FetchInterceptor()],
  });

  interceptor.on("request", async ({ request, controller }) => {
    try {
      const response = await handle(request);

      if (response) {
        controller.respondWith(response);
      }
    } catch (error) {
      controller.errorWith(error);
    }
  });

  interceptor.apply();

  return interceptor;
}
