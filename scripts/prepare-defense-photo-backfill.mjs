import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { parseWorkbook } from "../lib/monitoring/ingestion/parsers.ts";
import { safePhotoReference } from "../lib/monitoring/ingestion/files.ts";
import { normalizeIdentifier, normalizeLabel, sha256 } from "../lib/monitoring/ingestion/validation.ts";

export function normalizeEmployeeNumber(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text.replace(/^0+/, "") || null : null;
}

export function cpfFromImageName(name) {
  const stem = basename(name, extname(name));
  if (!/^\d{1,11}$/.test(stem)) return null;
  try { return normalizeIdentifier(stem.padStart(11, "0"), "cpf"); } catch { return null; }
}

export function photoFileName(cpf, fullName, extension = ".jpg") {
  normalizeIdentifier(cpf, "cpf");
  if (!/^\.(jpg|jpeg|png|webp)$/.test(extension)) throw new Error("INVALID_PHOTO_EXTENSION");
  const name = String(fullName).normalize("NFC").trim().replace(/\s+/g, " ").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "");
  if (!name || name.length > 150) throw new Error("INVALID_PHOTO_FULL_NAME");
  return `${cpf} - ${name}${extension}`;
}

const groupBy = (rows, key) => {
  const result = new Map();
  for (const row of rows) {
    const value = key(row);
    if (value === null || value === undefined) continue;
    result.set(value, [...(result.get(value) ?? []), row]);
  }
  return result;
};
const distinct = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];

/** Planning is pure: only an exact, unique employee number and normalized full name can release a photo. */
export function planDefensePhotoBackfill(clock, defensePeople, photos) {
  const allCpfEntries = clock.entries.filter(row => row.identityType === "cpf" && row.cpf);
  const clockByNumber = groupBy(allCpfEntries, row => normalizeEmployeeNumber(row.employeeNumber));
  const clockByCpf = groupBy(allCpfEntries, row => row.cpf);
  const defenseByNumber = groupBy(defensePeople, row => normalizeEmployeeNumber(row.externalId));
  const photosByCpf = groupBy(photos.filter(row => row.valid && row.cpf), row => row.cpf);
  const reviews = [];
  const decisions = [];
  for (const person of defensePeople) {
    const employeeNumber = normalizeEmployeeNumber(person.externalId);
    const row = { defenseId: person.externalId, employeeNumber, fullName: person.name, defensePhotoReference: person.photoReference ?? "", defensePhotoStatus: person.photoStatus, cpf: "", clockPhoto: null, status: "", evidence: "" };
    const candidates = clockByNumber.get(employeeNumber) ?? [];
    const distinctClock = distinct(candidates, entry => `${entry.cpf}|${normalizeLabel(entry.fullName)}`);
    const defenseCandidates = distinct(defenseByNumber.get(employeeNumber) ?? [], entry => `${entry.externalId}|${normalizeLabel(entry.name)}`);
    if (!employeeNumber) row.status = "DEFENSE_MATRICULA_INVALIDA";
    else if (defenseCandidates.length !== 1) row.status = "DEFENSE_MATRICULA_AMBIGUA";
    else if (!candidates.length) row.status = "SEM_CADASTRO_CPF_COM_MATRICULA";
    else if (distinctClock.length !== 1) row.status = "RELOGIO_MATRICULA_AMBIGUA";
    else {
      const candidate = distinctClock[0];
      row.cpf = candidate.cpf;
      if (!candidate.identifierValid || candidates.some(entry => entry.conflicts?.length)) row.status = "CADASTRO_CPF_COM_CONFLITO";
      else if (distinct(clockByCpf.get(candidate.cpf) ?? [], entry => `${normalizeEmployeeNumber(entry.employeeNumber)}|${normalizeLabel(entry.fullName)}`).length !== 1) row.status = "CPF_COM_CADASTROS_DIVERGENTES";
      else if (normalizeLabel(candidate.fullName) !== normalizeLabel(person.name)) row.status = "NOME_DIVERGENTE";
      else {
        row.evidence = "MATRICULA_EXATA_E_NOME_COMPLETO_NORMALIZADO";
        const images = distinct(photosByCpf.get(candidate.cpf) ?? [], image => image.sha256);
        if (person.photoStatus === "available") row.status = "DEFENSE_JA_TEM_FOTO";
        else if (person.photoStatus === "ambiguous" || person.photoStatus === "unsafe") row.status = "REFERENCIA_DEFENSE_PARA_REVISAO";
        else if (!images.length) row.status = "SEM_FOTO_VALIDA_NO_RELOGIO";
        else if (images.length !== 1) row.status = "FOTOS_CPF_DIVERGENTES";
        else {
          row.clockPhoto = images[0];
          row.clockFullName = candidate.fullName;
          row.sourceRows = candidates.map(entry => ({ sourceFile: entry.sourceFile, sourceRow: entry.sourceRow }));
          row.fileName = photoFileName(candidate.cpf, person.name, images[0].extension);
          row.status = "PRONTA_PARA_DEFENSE";
        }
      }
    }
    decisions.push(row);
    if (!new Set(["PRONTA_PARA_DEFENSE", "DEFENSE_JA_TEM_FOTO", "SEM_FOTO_VALIDA_NO_RELOGIO"]).has(row.status)) reviews.push(row);
  }
  // Photos for people absent from the Defense snapshot stay in a report, never in the released package.
  for (const candidate of distinct(allCpfEntries, entry => `${entry.cpf}|${normalizeEmployeeNumber(entry.employeeNumber)}|${normalizeLabel(entry.fullName)}`)) {
    if (!photosByCpf.has(candidate.cpf) || defenseByNumber.has(normalizeEmployeeNumber(candidate.employeeNumber))) continue;
    reviews.push({ cpf: candidate.cpf, employeeNumber: candidate.employeeNumber, fullName: candidate.fullName, defenseId: "", status: "FOTO_RELOGIO_SEM_MATRICULA_NO_DEFENSE", evidence: "", defensePhotoStatus: "absent_person" });
  }
  const selected = distinct(decisions.filter(row => row.status === "PRONTA_PARA_DEFENSE"), row => `${row.cpf}|${row.defenseId}`);
  for (const row of selected) row.category = "CADASTRADOS_NO_DEFENSE_SEM_FOTO";
  if (new Set(selected.map(row => row.fileName.toUpperCase())).size !== selected.length) throw new Error("OUTPUT_PHOTO_NAME_COLLISION");
  return { decisions, selected, reviews };
}

export function addMissingDefenseRhPhotos(plan, clock, employees, defensePeople, photos) {
  const employeeByNumber = groupBy(employees.filter(row => row.active), row => normalizeEmployeeNumber(row.employeeNumber));
  const defenseByNumber = groupBy(defensePeople, row => normalizeEmployeeNumber(row.externalId));
  const defenseByName = groupBy(defensePeople, row => normalizeLabel(row.name));
  const missing = [...employeeByNumber.entries()].filter(([number, rows]) => number && rows.length === 1 && !defenseByNumber.has(number)).map(([number, rows]) => ({ externalId: number, name: rows[0].name, employeeId: rows[0].id, photoReference: null, photoStatus: "no_reference" }));
  const candidates = planDefensePhotoBackfill(clock, missing, photos);
  const released = [];
  const blocked = [];
  for (const row of candidates.selected) {
    const names = defenseByName.get(normalizeLabel(row.fullName)) ?? [];
    if (names.length) {
      blocked.push({ ...row, status: "NOME_EXISTE_NO_DEFENSE_COM_OUTRA_MATRICULA", matchingDefenseIds: names.map(person => person.externalId).join(", "), category: "CONFERIR" });
      continue;
    }
    released.push({ ...row, defenseId: "", status: "RH_SEM_CADASTRO_NO_DEFENSE", category: "SEM_CADASTRO_NO_DEFENSE", evidence: "RH_ATIVO_MATRICULA_E_NOME_COMPLETO_EXATOS_COM_CADASTRO_CPF", systemPersonStatus: "AUSENTE", systemPhotoPresent: "NAO", rhStatus: "RH_ATIVO_EXATO" });
  }
  const releasedKeys = new Set(released.map(row => `${row.cpf}|${row.employeeNumber}`));
  const blockedKeys = new Set(blocked.map(row => `${row.cpf}|${row.employeeNumber}`));
  plan.reviews = plan.reviews.filter(row => row.status !== "FOTO_RELOGIO_SEM_MATRICULA_NO_DEFENSE" || (!releasedKeys.has(`${row.cpf}|${row.employeeNumber}`) && !blockedKeys.has(`${row.cpf}|${row.employeeNumber}`)));
  plan.reviews.push(...blocked);
  plan.missingDefenseRh = [...released, ...blocked];
  plan.selected.push(...released);
  return { activeRhMissingDefenseWithSafeClockPhoto: candidates.selected.length, released: released.length, conflictingDefenseNames: blocked.length };
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function imageMetadata(path) {
  const bytes = await readFile(path);
  if (bytes.length > 10 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE");
  const decoder = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" });
  const metadata = await decoder.metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("INVALID_IMAGE");
  await decoder.stats();
  return { sha256: sha256(bytes), bytes: bytes.length, width: metadata.width, height: metadata.height, mimeType: `image/${metadata.format}`, extension: metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}` };
}

export async function scanClockPhotos(root) {
  const actualRoot = await realpath(root);
  const photos = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
        const cpf = cpfFromImageName(entry.name);
        const row = { path, relativePath: relative(actualRoot, path), cpf, identifierPadded: basename(entry.name, extname(entry.name)).length < 11, valid: false };
        try { Object.assign(row, await imageMetadata(path)); row.valid = cpf !== null; if (!cpf) row.error = "INVALID_CPF_FILENAME"; }
        catch { row.error = "INVALID_IMAGE"; }
        photos.push(row);
      }
    }
  }
  await visit(actualRoot);
  return photos.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function inspectDefensePhoto(root, reference) {
  if (!reference) return { photoStatus: "no_reference", photoPath: null };
  let normalized;
  try { normalized = safePhotoReference(reference); } catch { return { photoStatus: "unsafe", photoPath: null }; }
  const path = resolve(root, normalized);
  if (!inside(root, path)) return { photoStatus: "unsafe", photoPath: null };
  try {
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink() || !inside(root, await realpath(path))) return { photoStatus: "unsafe", photoPath: null };
    await imageMetadata(path);
    return { photoStatus: "available", photoPath: path };
  } catch (error) { return { photoStatus: error.code === "ENOENT" ? "missing" : "invalid", photoPath: null }; }
}

export function csvRows(rows, columns) {
  const value = input => {
    const text = String(input ?? "");
    return `"${(/^[=+@-]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
  };
  return `\ufeff${[columns.map(value).join(";"), ...rows.map(row => columns.map(column => value(row[column])).join(";"))].join("\r\n")}\r\n`;
}

export function compareSystemSnapshot(plan, snapshot, sourceId) {
  const people = groupBy(snapshot.people.filter(row => row.sourceId === sourceId), row => row.externalId);
  const photos = groupBy(snapshot.photos.filter(row => row.sourceId === sourceId), row => row.identityValue);
  for (const row of plan.decisions) {
    const matches = people.get(row.defenseId) ?? [];
    row.systemPersonStatus = matches.length !== 1 ? "AUSENTE_OU_AMBIGUO" : matches[0].ambiguous || normalizeLabel(matches[0].name) !== normalizeLabel(row.fullName) ? "DIVERGENTE" : "COINCIDENTE";
    row.systemPhotoPresent = photos.has(row.defenseId) ? "SIM" : "NAO";
    const rhMatches = (snapshot.employees ?? []).filter(employee => employee.active && normalizeEmployeeNumber(employee.employeeNumber) === row.employeeNumber && normalizeLabel(employee.name) === normalizeLabel(row.fullName));
    row.rhStatus = rhMatches.length === 1 ? "RH_ATIVO_EXATO" : "SEM_CORRESPONDENCIA_UNICA_RH_ATIVO";
  }
  return {
    checkedAt: snapshot.checkedAt,
    samePeople: plan.decisions.filter(row => row.systemPersonStatus === "COINCIDENTE").length,
    differentPeople: plan.decisions.filter(row => row.systemPersonStatus !== "COINCIDENTE").length,
    photoPresenceDifferences: plan.decisions.filter(row => (row.defensePhotoStatus === "available") !== (row.systemPhotoPresent === "SIM")).length,
    eligiblePhotosAlreadyInSystem: plan.selected.filter(row => row.systemPhotoPresent === "SIM").length,
    existingDefenseSelectedOutsideActiveRh: plan.selected.filter(row => row.rhStatus !== "RH_ATIVO_EXATO").length,
  };
}

export async function writePhotoPackage(output, plan, photos, summary, copyImages) {
  await mkdir(output, { recursive: false });
  const imageDirectory = join(output, "fotos-para-defense");
  await mkdir(imageDirectory);
  for (const category of new Set(plan.selected.map(row => row.category))) await mkdir(join(imageDirectory, category));
  for (const row of plan.selected) {
    if (!copyImages) continue;
    const target = join(imageDirectory, row.category, row.fileName);
    await copyFile(row.clockPhoto.path, target, constants.COPYFILE_EXCL);
    if (sha256(await readFile(target)) !== row.clockPhoto.sha256) throw new Error("COPIED_PHOTO_HASH_MISMATCH");
  }
  const columns = ["cpf", "employeeNumber", "fullName", "defenseId", "category", "status", "evidence", "defensePhotoStatus", "defensePhotoReference", "systemPersonStatus", "systemPhotoPresent", "rhStatus", "matchingDefenseIds", "fileName", "sourceFile", "sha256"];
  const manifest = plan.selected.map(row => ({ ...row, sourceFile: row.clockPhoto.relativePath, sha256: row.clockPhoto.sha256 }));
  await writeFile(join(output, "fotos-para-defense.csv"), csvRows(manifest, columns));
  await writeFile(join(output, "comparacao-defense.csv"), csvRows(plan.decisions, columns));
  await writeFile(join(output, "revisar.csv"), csvRows(plan.reviews, columns));
  await writeFile(join(output, "fotos-sem-cadastro-defense.csv"), csvRows(plan.reviews.filter(row => row.status === "FOTO_RELOGIO_SEM_MATRICULA_NO_DEFENSE"), columns));
  await writeFile(join(output, "rh-sem-cadastro-defense.csv"), csvRows(plan.missingDefenseRh ?? [], columns));
  await writeFile(join(output, "conflitos.csv"), csvRows(plan.reviews.filter(row => !["FOTO_RELOGIO_SEM_MATRICULA_NO_DEFENSE", "SEM_CADASTRO_CPF_COM_MATRICULA"].includes(row.status)), columns));
  await writeFile(join(output, "imagens-rejeitadas.csv"), csvRows(photos.filter(row => !row.valid), ["relativePath", "error", "sha256"]));
  await writeFile(join(output, "clock-photo-index.json"), JSON.stringify(photos, null, 2));
  await writeFile(join(output, "photo-plan.json"), JSON.stringify(plan, null, 2));
  await writeFile(join(output, "LEIA-ME.txt"), "Fotos para atualização manual do Defense. As imagens são cópias byte a byte; os originais não foram alterados.\r\n\r\nCADASTRADOS_NO_DEFENSE_SEM_FOTO: cadastro Defense existente, sem imagem no export, matrícula e nome completo coincidentes com CPF do relógio.\r\nSEM_CADASTRO_NO_DEFENSE: colaborador ativo do RH, com matrícula e nome completo coincidentes com CPF do relógio, sem matrícula nem nome coincidentes no export Defense.\r\n\r\nA ausência é relativa ao cadastro e à pasta de imagens exportados do Defense. Nenhum cadastro remoto foi alterado por este script.\r\n\r\nAbra fotos-para-defense.csv para ver CPF, nome completo, matrícula, evidência e hash. comparacao-defense.csv inclui todos os cadastros do Defense. As colunas systemPersonStatus e systemPhotoPresent registram separadamente a comparação com o snapshot do sistema, quando fornecido. fotos-sem-cadastro-defense.csv lista demais fotos sem matrícula correspondente no export Defense, sem liberação para inclusão. rh-sem-cadastro-defense.csv detalha a conferência com RH. conflitos.csv separa divergências. imagens-rejeitadas.csv lista arquivos sem CPF ou imagem válidos. revisar.csv reúne todos os casos não liberados; essas fotos não são copiadas.\r\n\r\nOs arquivos contêm dados pessoais. Mantenha a pasta em local restrito.\r\n");
  const result = { ...summary, completed: true, copiedImages: copyImages ? plan.selected.length : 0, mode: copyImages ? "local-copies" : "preview", output };
  await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
  return result;
}

export async function prepareDefensePhotoBackfill(options) {
  const workspace = resolve(options.workspace ?? process.cwd());
  const allowedOutput = resolve(workspace, "artifacts/clock-reconciliation");
  const output = resolve(options.output ?? join(allowedOutput, `defense-fotos-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${randomUUID().slice(0, 8)}`));
  if (!inside(allowedOutput, output) || output === allowedOutput) throw new Error("OUTPUT_MUST_BE_PRIVATE_ARTIFACT_DIRECTORY");
  const clock = JSON.parse(await readFile(resolve(workspace, options.clock ?? "artifacts/clock-reconciliation/clock-users.json"), "utf8"));
  if (clock.version !== 1 || !Array.isArray(clock.entries)) throw new Error("INVALID_CLOCK_CROSSWALK");
  const config = JSON.parse(await readFile(resolve(workspace, options.config ?? "monitoramento.local.json"), "utf8"));
  const source = config.sources.find(row => row.kind === "defense-person");
  if (!source?.photoRoot) throw new Error("DEFENSE_PHOTO_SOURCE_REQUIRED");
  const sourceRoot = resolve(workspace, source.root);
  const photoRoot = await realpath(resolve(workspace, source.photoRoot));
  const workbookFiles = (await readdir(sourceRoot)).filter(name => /\.xlsx$/i.test(name));
  if (!options.person && workbookFiles.length !== 1) throw new Error("EXPLICIT_DEFENSE_WORKBOOK_REQUIRED");
  const personPath = options.person ? resolve(workspace, options.person) : join(sourceRoot, workbookFiles[0]);
  const workbookBytes = await readFile(personPath);
  const parsed = await parseWorkbook(workbookBytes, source);
  if (parsed.occurrences.some(row => !row.person)) throw new Error("DEFENSE_WORKBOOK_HAS_REJECTED_ROWS");
  const defensePeople = [];
  for (const row of parsed.occurrences) defensePeople.push({ ...row.person, ...await inspectDefensePhoto(photoRoot, row.person.photoReference) });
  const photos = await scanClockPhotos(resolve(workspace, options.images ?? "relogio de ponto/user_images"));
  const plan = planDefensePhotoBackfill(clock, defensePeople, photos);
  const snapshot = options.snapshot ? JSON.parse(await readFile(resolve(workspace, options.snapshot), "utf8")) : null;
  const systemComparison = snapshot ? compareSystemSnapshot(plan, snapshot, source.id) : null;
  const missingDefenseRh = snapshot ? addMissingDefenseRhPhotos(plan, clock, snapshot.employees, defensePeople, photos) : null;
  const statuses = Object.fromEntries([...groupBy(plan.decisions, row => row.status)].map(([status, values]) => [status, values.length]));
  const summary = { generatedAt: new Date().toISOString(), defenseWorkbookSha256: sha256(workbookBytes), defensePeople: defensePeople.length, defensePhotosAvailable: defensePeople.filter(row => row.photoStatus === "available").length, clockPhotoFiles: photos.length, clockValidPhotoFiles: photos.filter(row => row.valid).length, clockInvalidPhotoFiles: photos.filter(row => !row.valid).length, paddedClockPhotoIdentifiers: photos.filter(row => row.identifierPadded).length, eligiblePhotos: plan.selected.length, photosWithoutDefenseEmployeeNumber: plan.reviews.filter(row => row.status === "FOTO_RELOGIO_SEM_MATRICULA_NO_DEFENSE").length, reviewRows: plan.reviews.length, systemComparison, missingDefenseRh, statuses };
  await mkdir(dirname(output), { recursive: true });
  return writePhotoPackage(output, plan, photos, summary, Boolean(options.copy));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--copy") options.copy = true;
    else if (["--workspace", "--clock", "--config", "--images", "--person", "--output", "--snapshot"].includes(flag) && args[index + 1]) options[flag.slice(2)] = args[++index];
    else throw new Error("INVALID_ARGUMENT");
  }
  try { console.log(JSON.stringify(await prepareDefensePhotoBackfill(options), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
