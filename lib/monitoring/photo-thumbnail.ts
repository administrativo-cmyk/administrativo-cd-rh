import sharp from "sharp";

export class InvalidPhotoError extends Error {
  readonly code = "PHOTO_IMAGE_INVALID";
  constructor() { super("PHOTO_IMAGE_INVALID"); this.name = "InvalidPhotoError"; }
}

async function normalizePhoto(bytes: Buffer, preview: boolean): Promise<Buffer> {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new InvalidPhotoError();
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new InvalidPhotoError();
    // EXIF orientation is applied; the JPEG output discards source metadata.
    const output = await image.rotate()
      .resize(preview ? 1024 : 128, preview ? 1024 : 128, { fit: preview ? "inside" : "cover", withoutEnlargement: true })
      .jpeg(preview ? { quality: 92, chromaSubsampling: "4:4:4" } : { quality: 80 }).toBuffer();
    if (output.length > 2 * 1024 * 1024) throw new InvalidPhotoError();
    return output;
  } catch { throw new InvalidPhotoError(); }
}

export const createPhotoThumbnail = (bytes: Buffer) => normalizePhoto(bytes, false);
export const createPhotoPreview = (bytes: Buffer) => normalizePhoto(bytes, true);
