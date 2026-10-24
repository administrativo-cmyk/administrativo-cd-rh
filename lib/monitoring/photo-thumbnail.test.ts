import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createPhotoThumbnail, createPhotoPreview, InvalidPhotoError } from "./photo-thumbnail";

describe("miniatura de foto no servidor", () => {
  it("usa dependência rastreável e produz JPEG limitado sem metadados", async () => {
    const source = await sharp({ create: { width: 240, height: 180, channels: 3, background: "#00aabb" } }).withMetadata({ orientation: 6 }).png().toBuffer();
    const thumbnail = await createPhotoThumbnail(source);
    const metadata = await sharp(thumbnail).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 128, height: 128 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });
  it("recusa conteúdo inválido ou não permitido sem incluir seus bytes no erro", async () => {
    for (const input of [Buffer.alloc(0), Buffer.alloc(2 * 1024 * 1024 + 1), Buffer.from("private-photo-invalid"), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')]) {
      await expect(createPhotoThumbnail(input)).rejects.toEqual(expect.objectContaining({ code: "PHOTO_IMAGE_INVALID" }));
      await expect(createPhotoPreview(input)).rejects.toEqual(expect.objectContaining({ code: "PHOTO_IMAGE_INVALID" }));
    }
    expect(new InvalidPhotoError().message).toBe("PHOTO_IMAGE_INVALID");
  });
  it("preserva resolução e proporção do original no zoom, com orientação corrigida e sem metadados", async () => {
    const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#00aabb" } }).withMetadata({ orientation: 6 }).png().toBuffer();
    const metadata = await sharp(await createPhotoPreview(source)).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 600, height: 900, chromaSubsampling: "4:4:4" });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });
  it.each([[300, 300, 300, 300], [2400, 1200, 1024, 512]])("limita resolução sem inventar pixels: %sx%s", async (width, height, expectedWidth, expectedHeight) => {
    const source = await sharp({ create: { width, height, channels: 3, background: "#00aabb" } }).png().toBuffer();
    expect(await sharp(await createPhotoPreview(source)).metadata()).toMatchObject({ width: expectedWidth, height: expectedHeight });
  });
});
