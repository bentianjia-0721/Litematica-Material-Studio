interface Environment {
  readonly TEST_ORIGIN: string;
  readonly PRODUCTION_ORIGIN: string;
}

function upstreamRequest(request: Request, origin: string, pathname: string): Request {
  const incoming = new URL(request.url);
  const upstream = new URL(origin);
  upstream.pathname = pathname;
  upstream.search = incoming.search;
  return new Request(upstream, request);
}

export default {
  async fetch(request: Request, environment: Environment): Promise<Response> {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/test") {
      incoming.pathname = "/test/";
      return Response.redirect(incoming, 308);
    }

    // The /test* route also matches names such as /testing. Send those back to
    // the production Pages origin explicitly instead of recursively fetching
    // the same Worker route.
    if (!incoming.pathname.startsWith("/test/")) {
      return fetch(upstreamRequest(request, environment.PRODUCTION_ORIGIN, incoming.pathname));
    }

    const previewPath = incoming.pathname.slice("/test".length) || "/";
    const response = await fetch(upstreamRequest(request, environment.TEST_ORIGIN, previewPath));
    const headers = new Headers(response.headers);
    headers.set("X-Litematica-Environment", "test");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
