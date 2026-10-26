import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredSupabaseProjectRef, isTrustedSupabaseStorageOrigin } from "./storage-origin";

const project = "abcdefghijklmnopqrst";
afterEach(() => vi.unstubAllEnvs());

describe("trusted Supabase storage origin", () => {
  it("preserves managed project matching", () => {
    expect(isTrustedSupabaseStorageOrigin(new URL(`https://${project}.supabase.co`), project)).toBe(true);
    expect(isTrustedSupabaseStorageOrigin(new URL("https://zyxwvutsrqponmlkjihg.supabase.co"), project)).toBe(false);
  });
  it("requires an explicit self-hosted origin and preserves the archive project identity", () => {
    const origin = new URL("https://supabase-rh.example.com");
    vi.stubEnv("SUPABASE_SELF_HOSTED_ORIGIN", "");
    expect(isTrustedSupabaseStorageOrigin(origin, project)).toBe(false);
    vi.stubEnv("SUPABASE_SELF_HOSTED_ORIGIN", origin.origin);
    vi.stubEnv("MONITORING_SUPABASE_PROJECT_REF", project);
    expect(isTrustedSupabaseStorageOrigin(origin, project)).toBe(true);
    expect(configuredSupabaseProjectRef(origin.href)).toBe(project);
    expect(isTrustedSupabaseStorageOrigin(origin, "zyxwvutsrqponmlkjihg")).toBe(false);
    expect(isTrustedSupabaseStorageOrigin(new URL("https://other.example.com"), project)).toBe(false);
  });
  it.each([
    "http://supabase-rh.example.com", "https://user:password@supabase-rh.example.com",
    "https://supabase-rh.example.com/path", "https://supabase-rh.example.com/?key=value",
    "https://supabase-rh.example.com/#fragment",
  ])("rejects unsafe configured origins: %s", value => {
    vi.stubEnv("SUPABASE_SELF_HOSTED_ORIGIN", value);
    expect(isTrustedSupabaseStorageOrigin(new URL(value))).toBe(false);
  });
});
