import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archivePath, digest, indexPunch, localMonth, packObject, partRows, retentionWindow, unpackObject, type ArchiveManifest, type ArchivedRow } from "./format";
import { archiveFile, prepareArchive, readArchiveHistory, reconcileArchive, restoreArchiveOriginals, verifyArchive, type ArchiveConfiguration } from "./local";

const legacy = (nsr: number, date = "08102026", time = "0800", identity = "012345678909") => `${String(nsr).padStart(9, "0")}3${date}${time}${identity}ABCD`;
const iso = (nsr: number, date = "2026-10-08", time = "08:00:00") => `${String(nsr).padStart(9, "0")}3${date}T${time}-0300012345678909ABCD`;
const pisBase = "1234567890";
const pisDigit = 11 - [...pisBase].reduce((sum, char, index) => sum + Number(char) * [3, 2, 9, 8, 7, 6, 5, 4, 3, 2][index], 0) % 11;
const validPis = pisBase + (pisDigit > 9 ? 0 : pisDigit);
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "monitoring-archive-")); });
afterEach(async () => {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("monitoring-archive-")) throw new Error("UNSAFE_TEST_CLEANUP");
  await rm(resolved, { recursive: true, force: true });
});
async function fixture(): Promise<ArchiveConfiguration> {
  const pis = Buffer.from([legacy(1, "01012001"), legacy(2), legacy(3, "08102026", "1200", "000000000000"), "0000000044CADASTRO"].join("\r\n") + "\r\n");
  const cpf = Buffer.from(`0000000001Exportação do relógio\r\n${iso(1)}\r\n${iso(2, "2026-10-08", "12:00:00")}\r\n${iso(3).replace("012345678909", `0${validPis}`)}\r\n`, "latin1");
  const p = path.join(root, "pis.txt"); const c = path.join(root, "cpf.txt");
  await writeFile(p, pis); await writeFile(c, cpf);
  return { projectRef: "abcdefghijklmnopqrst", asOf: "2026-10-20", files: [
    { sourceId: "clock-pis", path: p, sha256: digest(pis), profile: "legacy", identityType: "pis", allowAlternate: true },
    { sourceId: "clock-cpf", path: c, sha256: digest(cpf), profile: "iso", identityType: "cpf" },
  ] };
}

describe("private AFD archive preparation", () => {
  it("restores every original byte and verifies each row against the original, including invalid and ancient records", async () => {
    const config = await fixture(); const out = path.join(root, "archive");
    const prepared = await prepareArchive(config, out);
    expect(prepared.receipt).toMatchObject({ rows: 8, punches: 5, rejectedPunches: 1, administrativeRows: 2, hotPunches: 4, coldPunches: 1, uniquePunches: 5, duplicates: 0, conflicts: 0 });
    expect(prepared.manifest.sources[1].allowAlternate).toBe(true);
    expect(prepared.manifest.sources[1].encoding).toBe("latin1");
    for (const [index, source] of prepared.manifest.sources.entries()) {
      expect(unpackObject(source.original, await archiveFile(out, source.original.path))).toEqual(await readFile(config.files[index].path));
    }
    expect(await verifyArchive(out)).toEqual(prepared.receipt);
    expect(JSON.parse(await readFile(path.join(out, "verification.json"), "utf8"))).toMatchObject({ cleanupAllowed: false, databaseChanged: false, storageUploaded: false });
  });
  it("identifies a complete re-export as already archived, keeping identical NSRs from two clocks separate", async () => {
    const config = await fixture(); const out = path.join(root, "archive");
    await prepareArchive(config, out);
    expect(await reconcileArchive(out, config)).toEqual({ newPunches: 0, repeatedPunches: 5, conflicts: 0, files: 2, databaseChanged: false });
  });
  it("restores the two original files to a new directory and refuses to overwrite them", async () => {
    const config = await fixture(); const out = path.join(root, "archive"); await prepareArchive(config, out);
    const restored = path.join(root, "restored"); const receipt = await restoreArchiveOriginals(out, restored);
    expect(receipt.files).toHaveLength(2);
    for (const [index, file] of receipt.files.entries()) expect(await readFile(path.join(restored, file.path))).toEqual(await readFile(config.files[index].path));
    await expect(restoreArchiveOriginals(out, restored)).rejects.toThrow();
  });
  it("reads historical punches by document and half-open interval from the archive without the source folder", async () => {
    const config = await fixture(); const out = path.join(root, "archive"); await prepareArchive(config, out);
    for (const file of config.files) await rm(file.path);
    const rows = await readArchiveHistory(out, { sourceId: "clock-cpf", identityType: "cpf", identity: "12345678909", from: "2026-10-08T08:00:00-03:00", to: "2026-10-08T12:00:00-03:00" });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ nsr: "000000001", timestamp: "2026-10-08T11:00:00.000Z", conflicted: false });
    expect(await verifyArchive(out)).toMatchObject({ punches: 5 });
  });
  it("rejects changed compressed objects and missing archive objects", async () => {
    const config = await fixture(); const out = path.join(root, "archive"); const { manifest } = await prepareArchive(config, out);
    const part = manifest.parts[0]; const file = path.join(out, part.path); const original = await readFile(file);
    original[12] ^= 1; await writeFile(file, original);
    await expect(verifyArchive(out)).rejects.toThrow("ARCHIVE_HASH_MISMATCH");
    await rm(file); await expect(verifyArchive(out)).rejects.toThrow();
  });
  it("rejects impossible history dates and oversized decompression before returning punches", async () => {
    const config = await fixture(); const out = path.join(root, "archive"); await prepareArchive(config, out);
    await expect(readArchiveHistory(out, { sourceId: "clock-cpf", identityType: "cpf", identity: "12345678909", from: "2026-02-30T00:00:00Z", to: "2026-03-03T00:00:00Z" })).rejects.toThrow();
    const packed = packObject("data.gz", Buffer.from("test"));
    expect(() => unpackObject({ ...packed.object, expandedBytes: 100 * 1024 * 1024 }, packed.compressed)).toThrow("ARCHIVE_HASH_MISMATCH");
  });
  it("rejects a forged normalized row even when its compressed hash and manifest byte totals are recomputed", async () => {
    const config = await fixture(); const out = path.join(root, "archive"); const { manifest } = await prepareArchive(config, out);
    const part = manifest.parts.find(part => part.punches > 0)!;
    const rows = partRows(unpackObject(part, await archiveFile(out, part.path)));
    rows[0].occurrence.event!.timestamp = "2001-01-01T15:00:00.000Z";
    const forged = packObject(part.path, Buffer.from(rows.map(row => JSON.stringify(row)).join("\n") + "\n"));
    manifest.totals.storedBytes += forged.object.bytes - part.bytes;
    Object.assign(part, forged.object);
    await writeFile(path.join(out, part.path), forged.compressed);
    await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest));
    await expect(verifyArchive(out)).rejects.toThrow("ARCHIVE_ROW_ORIGINAL_MISMATCH");
  });
  it("never overwrites a destination or an input and rejects an unexpected input hash", async () => {
    const config = await fixture(); const out = path.join(root, "archive"); await prepareArchive(config, out);
    await expect(prepareArchive(config, out)).rejects.toThrow();
    const before = await readFile(config.files[0].path);
    config.files[0].sha256 = "0".repeat(64);
    await expect(prepareArchive(config, path.join(root, "different"))).rejects.toThrow("ARCHIVE_INPUT_HASH_MISMATCH");
    expect(await readFile(config.files[0].path)).toEqual(before);
  });
  it("keeps both conflicting rows but does not seal a usable archive", async () => {
    const config = await fixture(); config.files = [config.files[0]];
    const bytes = Buffer.from(legacy(1) + "\n" + legacy(1, "08102026", "0900"));
    await writeFile(config.files[0].path, bytes); config.files[0].sha256 = digest(bytes);
    const out = path.join(root, "archive");
    await expect(prepareArchive(config, out)).rejects.toThrow("ARCHIVE_CONFLICT_REQUIRES_REVIEW");
    const candidate = JSON.parse(await readFile(path.join(out, "manifest.prepared.json"), "utf8")) as ArchiveManifest;
    expect(candidate.totals.rows).toBe(2);
    expect(unpackObject(candidate.sources[0].original, await archiveFile(out, candidate.sources[0].original.path))).toEqual(bytes);
    await expect(readFile(path.join(out, "manifest.json"))).rejects.toThrow();
  });
  it("rejects manifest path traversal and duplicate part references", async () => {
    const config = await fixture(); const out = path.join(root, "archive"); const { manifest } = await prepareArchive(config, out);
    await expect(archiveFile(out, "../cpf.txt")).rejects.toThrow("ARCHIVE_PATH_INVALID");
    manifest.parts.push(manifest.parts[0]);
    await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest));
    await expect(verifyArchive(out)).rejects.toThrow("ARCHIVE_MANIFEST_INVALID");
  });
});

describe("archive boundaries and identity", () => {
  it("uses payroll cycles 21-20 and includes the prior day for night journeys", () => {
    expect(retentionWindow("2026-10-20")).toEqual({ payrollCycles: 3, operationalFrom: "2026-07-21", eventFrom: "2026-07-20T00:00:00-03:00", boundaryBufferDays: 1 });
    expect(retentionWindow("2026-10-21").operationalFrom).toBe("2026-08-21");
    expect(retentionWindow("2026-01-01", 1).operationalFrom).toBe("2025-12-21");
    expect(() => retentionWindow("2026-02-30")).toThrow("ARCHIVE_RETENTION_INVALID");
    expect(localMonth("2026-10-01T02:00:00Z")).toBe("2026-09");
    expect(localMonth("2018-12-01T02:00:00Z")).toBe("2018-12");
  });
  it.each(["../outside", "/outside", "C:/outside", "folder//file", "folder/./file", "folder\\file"])("rejects unsafe paths %s", value => {
    expect(() => archivePath(value)).toThrow("ARCHIVE_PATH_INVALID");
  });
  it("keeps a changed NSR in conflict instead of treating it as a duplicate", () => {
    const index = new Map<string, string>();
    const row = { sourceId: "clock", occurrence: { payloadHash: digest("one"), event: { type: "punch", nsr: "000000001" } } } as ArchivedRow;
    expect(indexPunch(index, row)).toBe("new"); expect(indexPunch(index, row)).toBe("duplicate");
    expect(indexPunch(index, { ...row, occurrence: { ...row.occurrence, payloadHash: digest("different") } })).toBe("conflict");
    expect(indexPunch(index, { ...row, sourceId: "other-clock" })).toBe("new");
  });
});
