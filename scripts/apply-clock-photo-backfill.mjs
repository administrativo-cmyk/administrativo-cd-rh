import { readFile, writeFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { createPhotoThumbnail } from "../lib/monitoring/photo-thumbnail.ts";

// An explicit, bounded application of the reviewed private plan. No environment
// values or raw server error bodies are written to logs or reports.
const root = process.cwd();
const directory = resolve(root, "artifacts/clock-reconciliation");
const plan = JSON.parse(await readFile(resolve(directory, "application-plan.json"), "utf8"));
const apply = process.argv.includes("--apply");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceRoot = await realpath(resolve(root, "relogio de ponto/user_images"));
const checked = [];
const identities = new Set();
for (const item of plan.photos) {
  if (item.sourceId !== "ponto-iso-cd-jk" || item.identityType !== "cpf" || !/^\d{11}$/.test(item.identityValue)) throw new Error("PHOTO_PLAN_INVALID");
  if (identities.has(item.identityValue)) throw new Error("PHOTO_PLAN_DUPLICATE_CPF");
  identities.add(item.identityValue);
  const path = await realpath(item.path);
  const within = relative(sourceRoot, path);
  if (isAbsolute(within) || within === ".." || within.startsWith("..\\") || within.startsWith("../")) throw new Error("PHOTO_PATH_OUTSIDE_SOURCE");
  const bytes = await readFile(path);
  if (hash(bytes) !== item.sha256) throw new Error("PHOTO_SOURCE_CHANGED");
  const thumbnail = await createPhotoThumbnail(bytes);
  checked.push({ item, bytes, storedSha256: hash(thumbnail) });
}
await writeFile(resolve(directory, "photo-expected.json"), JSON.stringify(checked.map(({ item, storedSha256 }) => ({ employeeId: item.employeeId, employeeNumber: item.employeeNumber, sourceId: item.sourceId, identityValue: item.identityValue, originalSha256: item.sha256, storedSha256 })), null, 2));
if (apply) {
  process.loadEnvFile(resolve(root, ".env.local"));
  const token = process.env.MONITORING_INGEST_TOKEN;
  if (!token) throw new Error("INGEST_TOKEN_UNAVAILABLE");
  const endpoint = "https://administrativo-cd-rh.vercel.app/api/monitoring/ingest/photo";
  const authorization = `Bearer ${token}`;
  // Check the deployed API before sending any image; old versions ignore the
  // insertOnly flag and cannot safely be discovered with a mutating POST.
  const capabilityResponse = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(30000), headers: { Authorization: authorization } });
  if (!capabilityResponse.ok) throw new Error("PHOTO_INSERT_ONLY_API_UNAVAILABLE");
  const capabilities = await capabilityResponse.json();
  if (capabilities.insertOnly !== true || capabilities.protocolVersion !== 1) throw new Error("PHOTO_INSERT_ONLY_API_UNAVAILABLE");
  const receiptPath = resolve(directory, "photo-application-receipts.json");
  let receipts;
  try { receipts = JSON.parse(await readFile(receiptPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; receipts = []; }
  const confirmed = (item, storedSha256) => receipts.some(r => r.sourceId === item.sourceId && r.identityValue === item.identityValue && r.storedSha256 === storedSha256 && r.accepted && r.insertOnly === true && ["inserted", "replayed"].includes(r.status));
  let accepted = checked.filter(({ item, storedSha256 }) => confirmed(item, storedSha256)).length;
  for (const { item, bytes, storedSha256 } of checked) {
    if (confirmed(item, storedSha256)) continue;
    const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json", Authorization: authorization }, body: JSON.stringify({ sourceId: item.sourceId, identityValue: item.identityValue, sha256: item.sha256, mimeType: "image/jpeg", base64: bytes.toString("base64"), insertOnly: true }) });
    if (!response.ok) throw new Error(`PHOTO_UPLOAD_HTTP_${response.status}`);
    const result = await response.json();
    if (result.accepted !== true || result.insertOnly !== true || !["inserted", "replayed"].includes(result.status) || result.sha256 !== storedSha256) throw new Error("PHOTO_UPLOAD_NOT_CONFIRMED");
    receipts.push({ sourceId: item.sourceId, identityValue: item.identityValue, storedSha256, accepted: true, insertOnly: true, status: result.status, acceptedAt: new Date().toISOString() });
    await writeFile(receiptPath, JSON.stringify(receipts, null, 2));
    accepted++;
    if (accepted % 10 === 0) console.log(JSON.stringify({ accepted, expected: checked.length }));
  }
  console.log(JSON.stringify({ applied: true, accepted, expected: checked.length }));
} else console.log(JSON.stringify({ mode: "dry-run", validPhotos: checked.length, expectedHashesSaved: true, uploaded: 0 }));
