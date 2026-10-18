import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import sharp from "sharp";
import { attachmentLimit } from "./daily-call-operations";
export class InvalidAttachmentError extends Error { constructor(options?: ErrorOptions) { super("Arquivo inválido. Envie PDF sem senha ou imagem PNG/JPEG de até 2 MiB.", options); } }
export async function validateAttachment(bytes: Buffer, mediaType: string): Promise<void> {
 if (!bytes.length || bytes.length > attachmentLimit) throw new InvalidAttachmentError();
 try {
  if (mediaType === "application/pdf") {
   if (bytes.subarray(0, 5).toString() !== "%PDF-" || !bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) throw new InvalidAttachmentError();
   const document = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
   if (document.isEncrypted || document.getPageCount() < 1 || document.getPageCount() > 100) throw new InvalidAttachmentError();
   const seen = new WeakSet<object>(); let visited = 0;
   function inspect(value: unknown, depth = 0) {
    if (depth > 60 || ++visited > 50000) throw new InvalidAttachmentError();
    if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value);
    if (value instanceof PDFDict) for (const [key, child] of value.entries()) {
     if (["JavaScript", "JS", "OpenAction", "AA", "Launch", "EmbeddedFile", "EmbeddedFiles", "RichMedia", "XFA"].includes(key.decodeText())) throw new InvalidAttachmentError();
     if (child instanceof PDFName && ["JavaScript", "Launch", "EmbeddedFile", "RichMedia"].includes(child.decodeText())) throw new InvalidAttachmentError();
     inspect(child, depth + 1);
    }
    if (value instanceof PDFArray) for (const child of value.asArray()) inspect(child, depth + 1);
    if ("dict" in value && value.dict instanceof PDFDict) inspect(value.dict, depth + 1);
   }
   for (const [, object] of document.context.enumerateIndirectObjects()) inspect(object);
  } else {
   const expected = mediaType === "image/png" ? "png" : mediaType === "image/jpeg" ? "jpeg" : "";
   if (!expected) throw new InvalidAttachmentError();
   const image = sharp(bytes, { limitInputPixels: 10_000_000, failOn: "warning" });
   const metadata = await image.metadata();
   if (metadata.format !== expected || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new InvalidAttachmentError();
   await image.raw().toBuffer(); // Decode the complete image, including truncated-data checks.
  }
 } catch (cause) { throw new InvalidAttachmentError({ cause }); }
}
