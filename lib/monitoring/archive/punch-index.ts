import { z } from "zod";
import type { CanonicalImportEvent } from "../ingestion/types.ts";
import { normalizeIdentifier } from "../ingestion/validation.ts";
import { digest } from "./format.ts";

export const nsrShardSize = 10_000;
const originSchema = z.object({ fileSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), line: z.number().int().positive().optional(),
  snapshotPath: z.string().max(240).optional(), eventId: z.string().uuid().optional() }).strict();
const punchSchema = z.object({ nsr: z.string().regex(/^\d{9}$/), key: z.string().min(1).max(100), payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.string().datetime({offset:true}), precisionSeconds: z.union([z.literal(1),z.literal(60)]), profile:z.enum(["legacy","iso"]),
  identityType: z.enum(["cpf","pis"]), identityValue: z.string().regex(/^\d{11}$/),
  eventId: z.string().uuid().optional(), conflicted: z.boolean(), origins: z.array(originSchema).max(32) }).strict();
export type IndexedPunch = z.infer<typeof punchSchema>;
export type PunchIndex = { version: 1; sourceId: string; shard: number; punches: IndexedPunch[] };
const indexSchema = z.object({ version:z.literal(1),sourceId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  shard:z.number().int().min(0).max(99999),punches:z.array(punchSchema).min(1).max(nsrShardSize) }).strict();

export const shardFor = (nsr:string) => {if(!/^\d{9}$/.test(nsr))throw new Error("ARCHIVE_NSR_INVALID");return Math.floor(Number(nsr)/nsrShardSize);};
export const identityHash = (type:string,value:string) => digest(`${type}:${value}`);
export function parsePunchIndex(value: unknown): PunchIndex {
  const index=indexSchema.parse(value);const keys=new Set<string>();
  for(const punch of index.punches){
    normalizeIdentifier(punch.identityValue,punch.identityType);
    if(shardFor(punch.nsr)!==index.shard||keys.has(punch.nsr))throw new Error("ARCHIVE_INDEX_INVALID");keys.add(punch.nsr);
  }
  return index;
}
export function equivalentPunch(a:IndexedPunch,b:IndexedPunch) {
  if(a.nsr!==b.nsr||a.identityType!==b.identityType||a.identityValue!==b.identityValue)return false;
  if(a.payloadHash!==b.payloadHash&&a.profile===b.profile)return false;
  const precision=Math.max(a.precisionSeconds,b.precisionSeconds)*1000;
  return Math.floor(Date.parse(a.at)/precision)===Math.floor(Date.parse(b.at)/precision);
}
export function mergeIndexedPunch(a: IndexedPunch | undefined, b:IndexedPunch): IndexedPunch {
  if(!a)return b;
  if(a.nsr!==b.nsr)throw new Error("ARCHIVE_NSR_INVALID");
  const equivalent=equivalentPunch(a,b);
  const better=b.precisionSeconds<a.precisionSeconds?b:a;
  const origins=[...new Map([...a.origins,...b.origins].map(origin=>[JSON.stringify(origin),origin])).values()].slice(0,32);
  return {...better,eventId:a.eventId??b.eventId,conflicted:a.conflicted||b.conflicted||!equivalent,origins};
}
export function indexedImport(event:CanonicalImportEvent,payloadHash:string,origins:IndexedPunch["origins"]):IndexedPunch {
  if(event.type!=="punch"||!event.nsr||!event.identity||event.identity.type==="defense")throw new Error("ARCHIVE_PUNCH_INVALID");
  return punchSchema.parse({nsr:event.nsr,key:event.key,payloadHash,at:new Date(event.timestamp).toISOString(),precisionSeconds:event.precisionSeconds,profile:event.original.profile,
    identityType:event.identity.type,identityValue:event.identity.value,conflicted:false,origins});
}
export function indexMetadata(index:PunchIndex) {
  const instants=index.punches.map(punch=>punch.at).sort();
  return {sourceId:index.sourceId,shard:index.shard,rows:index.punches.length,minAt:instants[0],maxAt:instants.at(-1),
    identityHashes:[...new Set(index.punches.map(punch=>identityHash(punch.identityType,punch.identityValue)))].sort()};
}

/** Calendar months, matching Postgres date - interval '3 months', including month-end clamping. */
export function rollingWindow(asOf:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString().slice(0,10)!==asOf)throw new Error("ARCHIVE_RETENTION_INVALID");
  const [year,month,day]=asOf.split("-").map(Number);const base=new Date(Date.UTC(year,month-4,1));
  const last=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+1,0)).getUTCDate();
  const cutoff=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth(),Math.min(day,last)));
  return {months:3,cutoff:cutoff.toISOString().slice(0,10),eventFrom:new Date(cutoff.getTime()-86400000).toISOString().slice(0,10)+"T00:00:00-03:00"};
}
