import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addMissingDefenseRhPhotos, compareSystemSnapshot, cpfFromImageName, csvRows, photoFileName, planDefensePhotoBackfill, writePhotoPackage } from "../scripts/prepare-defense-photo-backfill.mjs";
import { sha256 } from "../lib/monitoring/ingestion/validation";

const cpf = "52998224725";
const cpf2 = "11144477735";
const clockEntry = (changes = {}) => ({ cpf, pis: null, employeeNumber: "123", fullName: "Maria Ação Silva", sourceFile: "usuarios-cpf.txt", sourceRow: 2, identityType: "cpf", identifierValid: true, conflicts: [], ...changes });
const person = (changes = {}) => ({ externalId: "00123", name: "MARIA ACAO SILVA", photoReference: null, photoStatus: "no_reference", ...changes });
const photo = (changes = {}) => ({ cpf, valid: true, sha256: "hash-a", path: "original.jpg", relativePath: "original.jpg", extension: ".jpg", ...changes });
const plan = (entries = [clockEntry()], people = [person()], photos = [photo()]) => planDefensePhotoBackfill({ entries }, people, photos);
const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

describe("Defense photo backfill evidence", () => {
  it("releases only exact unique employee number and normalized full name", () => {
    const result = plan();
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].fileName).toBe(`${cpf} - MARIA ACAO SILVA.jpg`);
    expect(result.selected[0].evidence).toBe("MATRICULA_EXATA_E_NOME_COMPLETO_NORMALIZADO");
  });
  it("does not infer by name without the employee number", () => {
    const result = plan([clockEntry({ employeeNumber: "124" })]);
    expect(result.selected).toHaveLength(0);
    expect(result.reviews.map(row => row.status)).toContain("FOTO_RELOGIO_SEM_MATRICULA_NO_DEFENSE");
  });
  it("quarantines a different name despite matching employee number", () => {
    expect(plan([clockEntry({ fullName: "Outra Pessoa" })]).decisions[0].status).toBe("NOME_DIVERGENTE");
  });
  it("quarantines conflicting CPF records and existing conflict flags", () => {
    expect(plan([clockEntry(), clockEntry({ cpf: cpf2 })]).decisions[0].status).toBe("RELOGIO_MATRICULA_AMBIGUA");
    expect(plan([clockEntry({ conflicts: ["CROSS_CLOCK_NAME"] })]).decisions[0].status).toBe("CADASTRO_CPF_COM_CONFLITO");
    expect(plan([clockEntry(), clockEntry({ employeeNumber: "124" })]).decisions[0].status).toBe("CPF_COM_CADASTROS_DIVERGENTES");
  });
  it("quarantines Defense identifiers that collide after leading zero normalization", () => {
    const result = plan([clockEntry()], [person(), person({ externalId: "123" })]);
    expect(result.selected).toHaveLength(0);
    expect(result.decisions.every(row => row.status === "DEFENSE_MATRICULA_AMBIGUA")).toBe(true);
  });
  it("preserves existing Defense images while accepting a missing referenced file", () => {
    expect(plan([clockEntry()], [person({ photoReference: "00123-1.jpg", photoStatus: "available" })]).selected).toHaveLength(0);
    expect(plan([clockEntry()], [person({ photoReference: "00123-1.jpg", photoStatus: "missing" })]).selected).toHaveLength(1);
  });
  it("never releases invalid images or ambiguous image bytes", () => {
    expect(plan([clockEntry()], [person()], [photo({ valid: false })]).selected).toHaveLength(0);
    expect(plan([clockEntry()], [person()], [photo(), photo({ sha256: "hash-b" })]).decisions[0].status).toBe("FOTOS_CPF_DIVERGENTES");
    expect(plan([clockEntry()], [person()], [photo(), photo({ path: "copy.jpg" })]).selected).toHaveLength(1);
  });
  it("validates CPF check digits and restores omitted initial zeros only", () => {
    expect(cpfFromImageName("52998224725.jpg")).toBe(cpf);
    expect(cpfFromImageName("1234567890.jpg")).toBe("01234567890");
    expect(cpfFromImageName("12345678901.jpg")).toBeNull();
    expect(cpfFromImageName("00000000000.jpg")).toBeNull();
    expect(cpfFromImageName("52998224725-extra.jpg")).toBeNull();
  });
  it("separates published state from the local Defense snapshot without changing the package", () => {
    const result = plan();
    const summary = compareSystemSnapshot(result, { checkedAt: "2026-10-19T12:00:00Z", people: [{ sourceId: "defense", externalId: "00123", name: "MARIA ACAO SILVA", ambiguous: false }], photos: [{ sourceId: "defense", identityValue: "00123" }] }, "defense");
    expect(summary.samePeople).toBe(1);
    expect(summary.photoPresenceDifferences).toBe(1);
    expect(summary.eligiblePhotosAlreadyInSystem).toBe(1);
    expect(result.selected).toHaveLength(1);
  });
  it("releases an absent Defense person only with an exact active RH match", () => {
    const result = plan([clockEntry()], [], [photo()]);
    const employees = [{ id: "rh-1", active: true, employeeNumber: "00123", name: "MARIA ACAO SILVA" }];
    expect(addMissingDefenseRhPhotos(result, { entries: [clockEntry()] }, employees, [], [photo()]).released).toBe(1);
    expect(result.selected[0].category).toBe("SEM_CADASTRO_NO_DEFENSE");
    const inactive = plan([clockEntry()], [], [photo()]);
    expect(addMissingDefenseRhPhotos(inactive, { entries: [clockEntry()] }, [{ ...employees[0], active: false }], [], [photo()]).released).toBe(0);
  });
  it("holds a name already in Defense under another employee number", () => {
    const result = plan([clockEntry()], [], [photo()]);
    const employees = [{ id: "rh-1", active: true, employeeNumber: "123", name: "MARIA ACAO SILVA" }];
    const summary = addMissingDefenseRhPhotos(result, { entries: [clockEntry()] }, employees, [person({ externalId: "999" })], [photo()]);
    expect(summary.conflictingDefenseNames).toBe(1);
    expect(result.selected).toHaveLength(0);
    expect(result.reviews[0].status).toBe("NOME_EXISTE_NO_DEFENSE_COM_OUTRA_MATRICULA");
  });
  it("sanitizes Windows names and emits UTF-8 BOM with escaped CSV cells", () => {
    expect(photoFileName(cpf, 'Pessoa / Nome: Completo.')).toBe(`${cpf} - Pessoa _ Nome_ Completo.jpg`);
    expect(csvRows([{ name: '=1+1;"text"' }], ["name"])).toBe('\ufeff"name"\r\n"\'=1+1;""text"""\r\n');
  });
  it("copies exact bytes and refuses to overwrite an existing package", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "defense-backfill-")); directories.push(temporary);
    const bytes = Buffer.from("synthetic image bytes; copying preserves source content");
    const input = join(temporary, "source.jpg"); await writeFile(input, bytes);
    const selection = plan([clockEntry()], [person()], [photo({ path: input, sha256: sha256(bytes) })]);
    const output = join(temporary, "package");
    const summary = await writePhotoPackage(output, selection, [], {}, true);
    expect(summary.copiedImages).toBe(1);
    expect(await readFile(join(output, "fotos-para-defense", selection.selected[0].category, selection.selected[0].fileName))).toEqual(bytes);
    expect(await readFile(input)).toEqual(bytes);
    await expect(writePhotoPackage(output, selection, [], {}, true)).rejects.toThrow();
  });
});
