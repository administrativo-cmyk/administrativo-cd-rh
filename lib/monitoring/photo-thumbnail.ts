import sharp from "sharp";

export class InvalidPhotoError extends Error {
  readonly code = "PHOTO_IMAGE_INVALID";
  constructor() { super("PHOTO_IMAGE_INVALID"); this.name = "InvalidPhotoError"; }
}

export async function createPhotoThumbnail(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new InvalidPhotoError();
  try {
    const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) throw new InvalidPhotoError();
    // EXIF orientation is applied; the JPEG output discards source metadata.
    return await image.rotate().resize(128, 128, { fit: "cover", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch { throw new InvalidPhotoError(); }
}
