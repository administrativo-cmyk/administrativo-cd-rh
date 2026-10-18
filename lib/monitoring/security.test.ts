import { describe,it,expect } from 'vitest';
import { allowedIngestSource,validWorkerToken } from './ingest-security';
import { bindingSchema,filtersSchema,settingSchema } from './contracts';
import { safeCsvCell,monitoringCsv } from './export';
describe('monitoring boundaries',()=>{
 it('requires a strong server token, constant-time comparable exact bearer value and an explicit source',()=>{
  const key='synthetic-token-for-test-only-000000000000';
  expect(validWorkerToken(`Bearer ${key}`,key)).toBe(true);
  for(const header of [null,key,`Bearer ${key}x`,`Bearer ${key.slice(1)}`])expect(validWorkerToken(header,key)).toBe(false);
  expect(validWorkerToken('Bearer short','short')).toBe(false);
  expect(allowedIngestSource('b','a,b')).toBe(true);expect(allowedIngestSource('bc','a,b')).toBe(false);
 });
 it('neutralizes spreadsheet formulas without replacing an absent metric with zero',()=>{
  for(const value of ['=1+1',' +SUM(A1)','\t@LINK','-12'])expect(safeCsvCell(value)).toMatch(/^"'/);
  expect(safeCsvCell(null)).toBe('"Não apurável"');expect(safeCsvCell(0)).toBe('"0"');
  expect(monitoringCsv([],{filter:'=cmd'})).toContain('"\'=cmd"');
 });
 it('rejects non-finite dates, rollover dates and reversed ranges',()=>{
  for(const start of ['infinity','2026-02-30','-infinity'])expect(filtersSchema.safeParse({start,end:'2026-10-31'}).success).toBe(false);
  expect(filtersSchema.safeParse({start:'2026-10-17',end:'2026-10-16'}).success).toBe(false);
 });
 it('never truncates identifiers or silently repairs validity',()=>{
  const input={sourceId:'clock',identityType:'cpf',identityValue:'123456789012',employeeId:'80000000-0000-0000-0000-000000000001',validFrom:'2026-10-01',evidence:'Synthetic proof'};
  expect(bindingSchema.safeParse(input).success).toBe(false);
  const parsed=bindingSchema.parse({...input,identityType:'defense',identityValue:'000123'});expect(parsed.identityValue).toBe('000123');
  expect(bindingSchema.safeParse({...parsed,validTo:'2026-09-30'}).success).toBe(false);
 });
 it('requires declared coverage evidence and schedule hours',()=>{
  const base={target:'portal',validFrom:'2026-10-01',reason:'Synthetic fixture'};
  expect(settingSchema.safeParse({...base,kind:'coverage',payload:{area:'operation',start:'2026-10-01T08:00:00-03:00',end:'2026-10-01T17:00:00-03:00',sourceIds:[],declaredComplete:true,evidence:''}}).success).toBe(false);
  expect(settingSchema.safeParse({...base,kind:'schedule',payload:{workdayHours:8}}).success).toBe(false);
 });
 it('rejects rule durations below millisecond precision before persistence',()=>{
  const base={kind:'rule',target:'global',validFrom:'2026-10-01',reason:'Synthetic precision fixture'};
  const payload={punchRepeatSeconds:60,accessRepeatSeconds:10,initialLookbackSeconds:3600,maxJourneyHours:18};
  expect(settingSchema.safeParse({...base,payload:{...payload,punchRepeatSeconds:0.001,accessRepeatSeconds:1.5}}).success).toBe(true);
  for(const field of ['punchRepeatSeconds','accessRepeatSeconds','initialLookbackSeconds']){
   expect(settingSchema.safeParse({...base,payload:{...payload,[field]:0.0001}}).success).toBe(false);
   expect(settingSchema.safeParse({...base,payload:{...payload,[field]:Infinity}}).success).toBe(false);
  }
  expect(settingSchema.safeParse({...base,payload:{...payload,maxJourneyHours:18.0000001}}).success).toBe(false);
 });
 it('rejects mapping effects that contradict its own area and direction',()=>{
  const base={kind:'mapping',target:'Synthetic portal',validFrom:'2026-10-01',reason:'Synthetic topology fixture'};
  for(const area of ['operation','cafeteria','perimeter'])for(const direction of ['entry','exit']){
   const payload={pointId:'Synthetic portal',portalId:'fixture',area,direction,validated:true,eventClasses:['Desbloqueio por rosto']};
   const matching=direction==='entry'?'inside':'outside';
   const opposite=direction==='entry'?'outside':'inside';
   expect(settingSchema.safeParse({...base,payload:{...payload,effects:{[area]:matching}}}).success).toBe(true);
   expect(settingSchema.safeParse({...base,payload:{...payload,effects:{[area]:opposite}}}).success).toBe(false);
   expect(settingSchema.safeParse({...base,payload}).success).toBe(true);
  }
 });
 it('checks CPF and PIS digits while preserving legitimate leading zeros',()=>{
  const base={sourceId:'synthetic',employeeId:'80000000-0000-0000-0000-000000000001',validFrom:'2026-10-01',evidence:'Synthetic identifier proof'};
  for(const [identityType,identityValue] of [['cpf','01234567890'],['cpf','52998224725'],['pis','01234567897'],['pis','12044567832']]){
   const parsed=bindingSchema.parse({...base,identityType,identityValue});
   expect(parsed.identityValue).toBe(identityValue);
   expect(bindingSchema.safeParse({...base,identityType,identityValue:`${identityValue}0`}).success).toBe(false);
  }
  for(const [identityType,identityValue] of [['cpf','52998224724'],['cpf','11111111111'],['pis','12044567833'],['pis','00000000000']])expect(bindingSchema.safeParse({...base,identityType,identityValue}).success).toBe(false);
  expect(bindingSchema.parse({...base,identityType:'defense',identityValue:'000123'}).identityValue).toBe('000123');
 });
});
