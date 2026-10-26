import { createRequire } from "node:module";
import { open, readdir, realpath, lstat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ImportError, sha256 } from "./validation.ts";
import type { IngestionSource } from "./types.ts";

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", ".next", ".codegraph", "dist", "build", "coverage", "outputs", "artifacts", ".monitoring-worker"]);
export function assertWithin(root: string, file: string): void {
  const part = relative(root, file);
  if (!part || part === ".." || part.startsWith(`..\\`) || part.startsWith("../") || isAbsolute(part)) throw new ImportError("PATH_OUTSIDE_SOURCE_ROOT");
}

export async function safeFile(root: string, file: string): Promise<string> {
  const actualRoot = await realpath(root); const actualFile = await realpath(file);
  assertWithin(actualRoot, actualFile);
  if ((await lstat(file)).isSymbolicLink()) throw new ImportError("SYMLINK_NOT_ACCEPTED");
  return actualFile;
}

export async function listSourceFiles(source: IngestionSource): Promise<string[]> {
  const root = await realpath(source.root); const files: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 20) throw new ImportError("DIRECTORY_DEPTH_LIMIT");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith("~$") || /\.(tmp|part|partial|crdownload)$/i.test(entry.name)) continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (source.recursive && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) await visit(fullPath, depth + 1);
      } else if (entry.isFile() && (source.kind === "afd" ? /\.txt$/i : /\.xlsx$/i).test(entry.name)) {
        files.push(await safeFile(root, fullPath));
        if (files.length > 20_000) throw new ImportError("SOURCE_FILE_COUNT_LIMIT");
      }
    }
  };
  await visit(root, 0);
  return files.sort();
}

/** Hash and parser both receive this exact immutable buffer; originals are never modified. */
export async function readStableSnapshot(root: string, path: string, options: { stabilityMs?: number; maxBytes?: number; signal?: AbortSignal } = {}): Promise<Buffer> {
  const file = await safeFile(root, path);
  const first = await lstat(file, { bigint: true });
  if (!first.isFile()) throw new ImportError("SOURCE_NOT_REGULAR_FILE");
  const maxBytes = options.maxBytes ?? 80 * 1024 * 1024;
  if (first.size < BigInt(1) || first.size > BigInt(maxBytes)) throw new ImportError("FILE_SIZE_LIMIT");
  await delay(options.stabilityMs ?? 1500, undefined, { signal: options.signal });
  const same = (a: typeof first, b: typeof first) => a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.ino === b.ino;
  const before = await lstat(file, { bigint: true });
  if (!same(first, before) || before.isSymbolicLink()) throw new ImportError("FILE_NOT_STABLE");
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!same(before, opened)) throw new ImportError("FILE_CHANGED_DURING_OPEN");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const finalPath = await safeFile(root, path);
    if (!same(opened, after) || BigInt(bytes.length) !== after.size || finalPath !== file || !same(after, await lstat(file, { bigint: true }))) throw new ImportError("FILE_CHANGED_DURING_READ");
    return bytes;
  } finally { await handle.close(); }
}

export function safePhotoReference(reference: string): string {
  let value: string;
  try { value = decodeURIComponent(reference).replace(/\\/g, "/"); } catch { throw new ImportError("PHOTO_REFERENCE_INVALID"); }
  if (!value || value.length > 300 || /[\u0000-\u001f]/.test(value) || /[:?#]/.test(value) || value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..") || !/\.(jpe?g|png|webp)$/i.test(value)) throw new ImportError("PHOTO_REFERENCE_UNSAFE");
  return value;
}

export async function buildPhotoIndex(root: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  const actualRoot = await realpath(root);
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 12) throw new ImportError("PHOTO_DIRECTORY_DEPTH_LIMIT");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) await visit(path, depth + 1);
      else if (entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
        const safe = await safeFile(actualRoot, path);
        const entries = index.get(entry.name) ?? []; entries.push(safe); index.set(entry.name, entries);
        if (index.size > 100_000) throw new ImportError("PHOTO_COUNT_LIMIT");
      }
    }
  };
  await visit(actualRoot, 0); return index;
}

type SharpInstance = { metadata(): Promise<{ width?: number; height?: number; format?: string; pages?: number }>; stats(): Promise<unknown> };
type SharpFactory = (bytes: Buffer, options: { limitInputPixels: number; failOn: string }) => SharpInstance;
let sharp: SharpFactory | undefined;
function imageDecoder(): SharpFactory {
  if (sharp) return sharp;
  try {
    const require = createRequire(import.meta.url);
    const nextPath = dirname(require.resolve("next/package.json"));
    sharp = require(require.resolve("sharp", { paths: [nextPath] })) as SharpFactory;
    return sharp;
  } catch { throw new ImportError("PHOTO_DECODER_UNAVAILABLE"); }
}

export async function loadPhoto(root: string, reference: string, index?: Map<string, string[]>): Promise<{ bytes: Buffer; sha256: string; mimeType: "image/jpeg" | "image/png" | "image/webp" }> {
  const normalized = safePhotoReference(reference); const actualRoot = await realpath(root);
  let path: string;
  if (normalized.includes("/")) path = await safeFile(actualRoot, resolve(actualRoot, normalized));
  else {
    const matches = (index ?? await buildPhotoIndex(actualRoot)).get(basename(normalized)) ?? [];
    if (matches.length !== 1) throw new ImportError(matches.length ? "PHOTO_REFERENCE_AMBIGUOUS" : "PHOTO_FILE_MISSING");
    path = matches[0];
  }
  const bytes = await readStableSnapshot(actualRoot, path, { stabilityMs: 0, maxBytes: 10 * 1024 * 1024 });
  try {
    const decoder = imageDecoder()(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new ImportError("PHOTO_IMAGE_INVALID");
    if (bytes.length > 2_000_000) throw new ImportError("PHOTO_OUTPUT_SIZE_LIMIT");
    await decoder.stats();
    return { bytes, sha256: sha256(bytes), mimeType: `image/${metadata.format}` as "image/jpeg" | "image/png" | "image/webp" };
  } catch (error) { if (error instanceof ImportError) throw error; throw new ImportError("PHOTO_IMAGE_INVALID"); }
}
