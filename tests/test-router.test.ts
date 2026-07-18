import { afterEach, describe, expect, it, vi } from "vitest";
import router from "../cloudflare/test-router";

const environment = {
  TEST_ORIGIN: "https://test.example.pages.dev",
  PRODUCTION_ORIGIN: "https://production.example.pages.dev",
};

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare test path router", () => {
  it("normalizes /test to a trailing slash and keeps the query", async () => {
    const response = await router.fetch(
      new Request("https://litematica.bentianjia.com/test?source=check"),
      environment,
    );
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://litematica.bentianjia.com/test/?source=check",
    );
  });

  it("strips the /test prefix and labels preview responses", async () => {
    const mockedFetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe("GET");
      return Promise.resolve(new Response("preview", { headers: { "content-type": "text/html" } }));
    });
    vi.stubGlobal("fetch", mockedFetch);

    const response = await router.fetch(
      new Request("https://litematica.bentianjia.com/test/assets/app.js?v=1"),
      environment,
    );
    const proxied = mockedFetch.mock.calls[0]?.[0];
    expect(proxied).toBeInstanceOf(Request);
    expect(proxied?.url).toBe("https://test.example.pages.dev/assets/app.js?v=1");
    expect(response.headers.get("x-litematica-environment")).toBe("test");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("does not treat /testing as the test application", async () => {
    const mockedFetch = vi.fn(async (request: Request) =>
      Promise.resolve(new Response(request.url)),
    );
    vi.stubGlobal("fetch", mockedFetch);

    const response = await router.fetch(
      new Request("https://litematica.bentianjia.com/testing?keep=1"),
      environment,
    );
    expect(await response.text()).toBe("https://production.example.pages.dev/testing?keep=1");
  });
});
