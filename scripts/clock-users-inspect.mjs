import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { normalizeIdentifier } from "../lib/monitoring/ingestion/validation.ts";

// Read-only reconciliation. Credentials and biometric templates are deliberately discarded.
export const normalizeName = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
export const normalizeEmployeeNumber = value => /^\d+$/.test(value.trim()) ? value.trim().replace(/^0+/, "") || null : null;
export function clockIdentifier(raw, type) {
  const value = raw.trim();
  if (!/^[0-9]{1,11}$/.test(value) || !["cpf", "pis"].includes(type)) return { value: null, valid: false, padded: false };
  const padded = value.padStart(11, "0");
  try { return { value: normalizeIdentifier(padded, type), valid: true, padded: value !== padded }; }
  catch { return { value: null, valid: false, padded: value !== padded }; }
}
export function parseClockUsers(bytes, sourceFile) {
  let encoding = "utf-8"; let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { encoding = "windows-1252"; text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
  const headers = lines.shift().split(";").map(value => value.trim().toLowerCase());
  const identityType = headers[0];
  if (!["cpf", "pis"].includes(identityType) || headers[1] !== "nome" || headers[3] !== "matricula" || headers.length !== 9) throw new Error("UNSUPPORTED_CLOCK_USER_HEADER");
  const entries = []; const rejectedRows = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const fields = lines[index].split(";");
    if (fields.length !== headers.length || fields.slice(0, 4).some(value => /["\u0000-\u001f\u007f]/.test(value))) { rejectedRows.push({ sourceRow: index + 2, code: "INVALID_CLOCK_USER_FIELDS" }); continue; }
    const identifier = clockIdentifier(fields[0], identityType);
    const fullName = fields[1].trim().replace(/\s+/g, " ");
    const employeeNumber = normalizeEmployeeNumber(fields[3]);
    entries.push({ cpf: identityType === "cpf" ? identifier.value : null, pis: identityType === "pis" ? identifier.value : null, employeeNumber, fullName, sourceFile, sourceRow: index + 2, identityType, rawIdentifier: fields[0], identifierValid: identifier.valid, identifierPadded: identifier.padded, conflicts: [...(!identifier.valid ? ["INVALID_IDENTIFIER"] : []), ...(!fullName ? ["EMPTY_NAME"] : []), ...(!employeeNumber ? ["MISSING_EMPLOYEE_NUMBER"] : [])] });
  }
  const groups = (getKey) => { const result = new Map(); for (const entry of entries) { const key = getKey(entry); if (key) result.set(key, [...(result.get(key) || []), entry]); } return result; };
  const identityGroups = groups(entry => entry[identityType]); const employeeGroups = groups(entry => entry.employeeNumber);
  for (const rows of identityGroups.values()) {
    if (new Set(rows.map(row => normalizeName(row.fullName))).size > 1) rows.forEach(row => row.conflicts.push("IDENTITY_MULTIPLE_NAMES"));
    if (new Set(rows.map(row => row.employeeNumber).filter(Boolean)).size > 1) rows.forEach(row => row.conflicts.push("IDENTITY_MULTIPLE_EMPLOYEES"));
  }
  for (const rows of employeeGroups.values()) {
    if (new Set(rows.map(row => row[identityType]).filter(Boolean)).size > 1) rows.forEach(row => row.conflicts.push("EMPLOYEE_MULTIPLE_IDENTITIES"));
    if (new Set(rows.map(row => normalizeName(row.fullName))).size > 1) rows.forEach(row => row.conflicts.push("EMPLOYEE_MULTIPLE_NAMES"));
  }
  const conflictsByCode = {}; for (const entry of entries) for (const code of entry.conflicts) conflictsByCode[code] = (conflictsByCode[code] || 0) + 1;
  return { summary: { sourceFile, sha256: createHash("sha256").update(bytes).digest("hex"), encoding, identityType, headers, rows: entries.length, rejectedRows: rejectedRows.length, validIdentifiers: entries.filter(row => row.identifierValid).length, paddedValidIdentifiers: entries.filter(row => row.identifierValid && row.identifierPadded).length, uniqueValidIdentities: identityGroups.size, repeatedIdentityGroups: [...identityGroups.values()].filter(rows => rows.length > 1).length, repeatedEmployeeGroups: [...employeeGroups.values()].filter(rows => rows.length > 1).length, safeRows: entries.filter(row => !row.conflicts.length).length, conflictsByCode }, entries, rejectedRows };
}
export function bridgeClockUsers(entries) {
  const byEmployee = new Map();
  for (const entry of entries) if (entry.employeeNumber && !entry.conflicts.length) byEmployee.set(entry.employeeNumber, [...(byEmployee.get(entry.employeeNumber) || []), entry]);
  const bridges = []; const conflicts = [];
  for (const [employeeNumber, rows] of byEmployee) {
    const cpfs = [...new Set(rows.map(row => row.cpf).filter(Boolean))]; const pises = [...new Set(rows.map(row => row.pis).filter(Boolean))];
    if (!cpfs.length || !pises.length) continue;
    if (cpfs.length !== 1 || pises.length !== 1 || new Set(rows.map(row => normalizeName(row.fullName))).size !== 1) { conflicts.push({ employeeNumber, code: "CROSS_CLOCK_CONFLICT", rows: rows.map(({ sourceFile, sourceRow }) => ({ sourceFile, sourceRow })) }); continue; }
    bridges.push({ cpf: cpfs[0], pis: pises[0], employeeNumber, fullName: rows[0].fullName, sourceRows: rows.map(({ sourceFile, sourceRow }) => ({ sourceFile, sourceRow })) });
  }
  return { bridges, conflicts };
}
export function inspectAfd(bytes, sourceFile, entries, bridges) {
  const lines = bytes.toString("latin1").split(/\r\n|\r|\n/).filter(Boolean);
  const punches = lines.filter(line => line[9] === "3");
  const profile = punches[0]?.length === 38 ? "legacy" : punches[0]?.length === 50 ? "iso" : null;
  if (!profile) throw new Error("UNSUPPORTED_AFD_PROFILE");
  const identityType = profile === "legacy" ? "pis" : "cpf"; const rawOffset = profile === "legacy" ? 22 : 34;
  const ids = new Map(); let invalidPunches = 0;
  for (const row of punches) {
    try { const id = normalizeIdentifier(row.slice(rawOffset, rawOffset + 12), identityType, true); ids.set(id, (ids.get(id) || 0) + 1); }
    catch { invalidPunches++; }
  }
  const sourceRows = entries.filter(row => row.identityType === identityType && row.identifierValid);
  const safeRows = sourceRows.filter(row => !row.conflicts.length);
  const matching = [...ids.keys()].map(identity => ({ identity, punchCount: ids.get(identity), matches: sourceRows.filter(row => row[identityType] === identity), bridge: bridges.find(row => row[identityType] === identity) || null }));
  const matchedIds = matching.filter(row => row.matches.length).length;
  const safeIds = new Set(safeRows.map(row => row[identityType]));
  return { summary: { sourceFile, profile, identityType, punches: punches.length, invalidPunches, uniquePunchIdentities: ids.size, matchedIdentities: matchedIds, unmatchedIdentities: ids.size - matchedIds, identitiesWithSafeRegistry: [...ids.keys()].filter(id => safeIds.has(id)).length, identitiesWithBothCpfPis: matching.filter(row => row.bridge).length, matchedPunches: matching.filter(row => row.matches.length).reduce((sum, row) => sum + row.punchCount, 0) }, matching };
}
export async function inspectDirectory(projectRoot) {
  const root = path.join(projectRoot, "relogio de ponto"); const output = path.join(projectRoot, "artifacts", "clock-reconciliation");
  const files = await Promise.all(["usuarios.txt", "usuarios (1).txt"].map(async name => parseClockUsers(await readFile(path.join(root, name)), name)));
  const entries = files.flatMap(file => file.entries); const crosswalk = bridgeClockUsers(entries);
  const afdFiles = (await readdir(root)).filter(name => /^AFD.*\.txt$/i.test(name));
  const afd = await Promise.all(afdFiles.map(async name => inspectAfd(await readFile(path.join(root, name)), name, entries, crosswalk.bridges)));
  const images = (await readdir(path.join(root, "user_images"))).filter(name => /\.jpe?g$/i.test(name)).map(name => ({ fileName: name, ...clockIdentifier(path.parse(name).name, "cpf") }));
  const cpfIds = new Set(entries.filter(row => row.cpf).map(row => row.cpf));
  const summary = { files: files.map(file => file.summary), bridges: crosswalk.bridges.length, crossClockConflicts: crosswalk.conflicts.length, afd: afd.map(file => file.summary), images: { total: images.length, validCpfNames: images.filter(row => row.valid).length, matchingCpfRegistry: images.filter(row => row.valid && cpfIds.has(row.value)).length, noCpfRegistry: images.filter(row => row.valid && !cpfIds.has(row.value)).length } };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "clock-users.json"), JSON.stringify({ version: 1, files: files.map(file => file.summary), entries, ...crosswalk }, null, 2));
  await writeFile(path.join(output, "clock-afd-matches.json"), JSON.stringify(afd, null, 2));
  await writeFile(path.join(output, "clock-inspection-summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await inspectDirectory(process.cwd()), null, 2));
