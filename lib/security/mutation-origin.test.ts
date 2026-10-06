import { describe, expect, it } from "vitest";
import { isTrustedMutationOrigin } from "./mutation-origin";

const endpoint = "http://localhost:3000/api/daily-call/entry";
const development = { environment: "development" };

function request(origin?: string, extraHeaders: Record<string, string> = {}) {
  return new Request(endpoint, {
    method: "PUT",
    headers: { ...(origin === undefined ? {} : { Origin: origin }), ...extraHeaders },
  });
}

describe("trusted daily-call mutation origins", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:3000"])(
    "accepts the exact local development origin %s, regardless of the internal request URL",
    (origin) => expect(isTrustedMutationOrigin(request(origin), development)).toBe(true),
  );

  it.each([
    "http://evil.example",
    "http://localhost.evil.example",
    "http://127.0.0.1.evil.example",
    "http://localhost:3001",
    "http://localhost:3000/other",
    "null",
    "not an origin",
    "http://localhost:3000, http://evil.example",
  ])("rejects invalid or unapproved origin %s", (origin) => {
    expect(isTrustedMutationOrigin(request(origin), development)).toBe(false);
  });

  it("rejects missing Origin, cross-site Fetch Metadata and spoofed forwarding headers", () => {
    expect(isTrustedMutationOrigin(request(), development)).toBe(false);
    expect(isTrustedMutationOrigin(request("http://localhost:3000", { "Sec-Fetch-Site": "cross-site" }), development)).toBe(false);
    expect(isTrustedMutationOrigin(request("http://evil.example", {
      Host: "localhost:3000",
      "X-Forwarded-Host": "localhost:3000",
      "X-Forwarded-Proto": "http",
    }), development)).toBe(false);
  });

  it("accepts only the explicitly configured canonical HTTPS origin in production", () => {
    const production = { environment: "production", canonicalOrigin: "https://administrativo.example.com" };
    expect(isTrustedMutationOrigin(request("https://administrativo.example.com"), production)).toBe(true);
    expect(isTrustedMutationOrigin(request("https://evil.example"), production)).toBe(false);
    expect(isTrustedMutationOrigin(request("http://localhost:3000"), production)).toBe(false);
    expect(isTrustedMutationOrigin(request("https://administrativo.example.com"), { environment: "production" })).toBe(false);
    expect(isTrustedMutationOrigin(request("https://administrativo.example.com"), {
      environment: "production", canonicalOrigin: "http://administrativo.example.com",
    })).toBe(false);
  });
});
