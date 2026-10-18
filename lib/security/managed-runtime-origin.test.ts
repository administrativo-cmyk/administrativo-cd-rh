import { describe, expect, it } from "vitest";
import { isTrustedMutationOrigin } from "./mutation-origin";
const request = (origin: string, url = "http://localhost:3000/api/audit", crossSite = false) => new Request(url, { headers: { origin, ...(crossSite ? { "sec-fetch-site": "cross-site" } : {}) } });
describe("servidor local gerenciado", () => {
 const policy = { environment: "production", canonicalOrigin: "http://localhost:3000", allowLoopback: true };
 it("aceita somente origem local opt-in e destino local reconhecido", () => {
  expect(isTrustedMutationOrigin(request("http://localhost:3000"), policy)).toBe(true);
  expect(isTrustedMutationOrigin(request("http://localhost:3000"), { ...policy, allowLoopback: false })).toBe(false);
  expect(isTrustedMutationOrigin(request("https://evil.example"), policy)).toBe(false);
  expect(isTrustedMutationOrigin(request("http://localhost:3000", "https://public.example/api/audit"), policy)).toBe(false);
  expect(isTrustedMutationOrigin(request("http://localhost:3000", undefined, true), policy)).toBe(false);
 });
 it("não autoriza HTTP remoto ou portas arbitrárias", () => {
  expect(isTrustedMutationOrigin(request("http://server.example"), { ...policy, canonicalOrigin: "http://server.example" })).toBe(false);
  expect(isTrustedMutationOrigin(request("http://localhost:8787"), { ...policy, canonicalOrigin: "http://localhost:8787" })).toBe(false);
 });
});
