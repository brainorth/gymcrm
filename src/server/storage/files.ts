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
  svg: "image/svg+xml",
};

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
  const ext = normalizeExt(input.ext);
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
  const contentType = res.headers.get("content-type") || fallbackContentType;
  return { bytes, contentType };
}
