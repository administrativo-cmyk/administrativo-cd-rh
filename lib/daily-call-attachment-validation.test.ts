import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { validateAttachment } from "./daily-call-attachment-validation";
describe("validação real de anexos",()=>{
 it("aceita PDF com páginas e imagem PNG decodificável",async()=>{
  const document=await PDFDocument.create();document.addPage();
  await expect(validateAttachment(Buffer.from(await document.save()),"application/pdf")).resolves.toBeUndefined();
  const png=await sharp({create:{width:2,height:2,channels:3,background:"white"}}).png().toBuffer();
  await expect(validateAttachment(png,"image/png")).resolves.toBeUndefined();
  await expect(validateAttachment(png,"image/jpeg")).rejects.toThrow("Arquivo inválido");
 });
 it("recusa assinatura falsa, PDF sem páginas, scripts, arquivo embutido e excesso",async()=>{
  await expect(validateAttachment(Buffer.from("%PDF-1.7\ntexto\n%%EOF"),"application/pdf")).rejects.toThrow();
  await expect(validateAttachment(Buffer.from([137,80,78,71,13,10,26,10]),"image/png")).rejects.toThrow();
  const empty=await PDFDocument.create();await expect(validateAttachment(Buffer.from(await empty.save({addDefaultPage:false})),"application/pdf")).rejects.toThrow();
  const active=await PDFDocument.create();active.addPage();active.addJavaScript("test","app.alert('x')");await expect(validateAttachment(Buffer.from(await active.save()),"application/pdf")).rejects.toThrow();
  const embedded=await PDFDocument.create();embedded.addPage();await embedded.attach(new Uint8Array([1,2,3]),"file.txt");await expect(validateAttachment(Buffer.from(await embedded.save()),"application/pdf")).rejects.toThrow();
  await expect(validateAttachment(Buffer.alloc(2097153),"image/png")).rejects.toThrow();
 });
});
