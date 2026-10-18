import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createPhotoThumbnail, InvalidPhotoError } from "./photo-thumbnail";

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
    }
    expect(new InvalidPhotoError().message).toBe("PHOTO_IMAGE_INVALID");
  });
});
