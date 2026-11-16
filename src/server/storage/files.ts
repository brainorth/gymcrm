import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";
import { NotFoundError, ValidationFailedError } from "@/server/db/errors";

export const PRIVATE_FILE_KINDS = ["photo", "id_proof", "waiver"] as const;
export type PrivateFileKind = (typeof PRIVATE_FILE_KINDS)[number];

const UPLOADS_ROOT = path.resolve(process.cwd(), "var", "uploads");
const SUPABASE_BUCKET = "private-uploads";

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_EXT_RE = /^[a-zA-Z0-9]{1,10}$/;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const ALLOWED_MIME_TYPES = new Set(Object.keys(EXT_BY_MIME));

function matchesMagicBytes(mimeType: string, bytes: Uint8Array): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return (
        bytes.length >= 4 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
      );
    case "image/gif":
      return (
        bytes.length >= 4 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38
      );
    case "image/webp":
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "application/pdf":
      return (
        bytes.length >= 5 &&
        bytes[0] === 0x25 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x44 &&
        bytes[3] === 0x46 &&
        bytes[4] === 0x2d
      );
    default:
      return false;
  }
}

export function validateUploadFile(
  declaredContentType: string,
  bytes: Uint8Array,
): { contentType: string; ext: string } {
  const normalized = declaredContentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = EXT_BY_MIME[normalized];
  if (!ext) {
    throw new ValidationFailedError(
      "Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, or PDF.",
      { file: ["Unsupported file type."] },
    );
  }
  if (!matchesMagicBytes(normalized, bytes)) {
    throw new ValidationFailedError("File contents do not match the declared file type.", {
      file: ["File contents do not match the declared type."],
    });
  }
  return { contentType: normalized, ext };
}

function assertSafeSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT_RE.test(value)) {
    throw new ValidationFailedError(`Invalid ${label}.`);
  }
  return value;
}

function normalizeExt(ext: string): string {
  const cleaned = ext.trim().replace(/^\.+/, "").toLowerCase();
  if (!SAFE_EXT_RE.test(cleaned)) {
    throw new ValidationFailedError("Unsupported file extension.");
  }
  return cleaned;
}

function resolveLocalPath(key: string): string {
  if (!key || key.includes("\0") || key.includes("\\") || key.startsWith("/")) {
    throw new ValidationFailedError("Invalid file key.");
  }
  const parts = key.split("/");
  if (parts.some((p) => !p || p === "." || p === "..")) {
    throw new ValidationFailedError("Invalid file key.");
  }
  const target = path.resolve(UPLOADS_ROOT, ...parts);
  if (!target.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new ValidationFailedError("Invalid file key.");
  }
  return target;
}

function supabaseConfig(): { url: string; serviceRoleKey: string } {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for supabase storage.");
  }
  return {
    url: SUPABASE_URL.replace(/\/+$/, ""),
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function isPrivateFileKind(value: string): value is PrivateFileKind {
  return (PRIVATE_FILE_KINDS as readonly string[]).includes(value);
}

export async function savePrivateFile(input: {
  gymId: string;
  memberId: string;
  kind: PrivateFileKind;
  bytes: Uint8Array;
  contentType: string;
  ext: string;
}): Promise<{ key: string }> {
  if (!isPrivateFileKind(input.kind)) {
    throw new ValidationFailedError("Invalid file kind.");
  }
  const gymId = assertSafeSegment(input.gymId, "gymId");
  const memberId = assertSafeSegment(input.memberId, "memberId");
  const validated = validateUploadFile(input.contentType, input.bytes);
  const ext = normalizeExt(input.ext);
  if (CONTENT_TYPE_BY_EXT[ext] !== validated.contentType) {
    throw new ValidationFailedError("File extension does not match the file type.", {
      file: ["Unsupported file extension."],
    });
  }
  const key = `${gymId}/${memberId}/${input.kind}-${randomUUID()}.${ext}`;

  const driver = env().STORAGE_DRIVER;
  if (driver === "local") {
    const target = resolveLocalPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.bytes);
    return { key };
  }

  const { url, serviceRoleKey } = supabaseConfig();
  const res = await fetch(`${url}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": input.contentType || "application/octet-stream",
      "x-upsert": "false",
    },
    body: Buffer.from(input.bytes),
  });

  if (!res.ok) {
    throw new Error(`Supabase storage upload failed (${res.status})`);
  }

  return { key };
}

export async function readPrivateFile(
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  // Validate key format for both drivers so path traversal is impossible everywhere.
  const target = resolveLocalPath(key);
  const ext = path.extname(key).replace(/^\./, "").toLowerCase();
  const fallbackContentType = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";

  const driver = env().STORAGE_DRIVER;
  if (driver === "local") {
    try {
      const data = await readFile(target);
      return { bytes: new Uint8Array(data), contentType: fallbackContentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        throw new NotFoundError("File");
      }
      throw error;
    }
  }

  const { url, serviceRoleKey } = supabaseConfig();
  const res = await fetch(`${url}/storage/v1/object/${SUPABASE_BUCKET}/${key}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  });

  if (res.status === 404) {
    throw new NotFoundError("File");
  }
  if (!res.ok) {
    throw new Error(`Supabase storage read failed (${res.status})`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const rawContentType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const contentType =
    rawContentType && ALLOWED_MIME_TYPES.has(rawContentType)
      ? rawContentType
      : fallbackContentType;
  return { bytes, contentType };
}
