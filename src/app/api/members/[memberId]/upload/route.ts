import { NextResponse } from "next/server";
import { auditInContext } from "@/server/audit/log";
import { withTenant } from "@/server/auth/rbac";
import { AppError, NotFoundError, ValidationFailedError } from "@/server/db/errors";
import { isPrivateFileKind, savePrivateFile, type PrivateFileKind } from "@/server/storage/files";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

function resolveFileExtension(file: File): string {
  const fromMime = EXT_BY_MIME[file.type.toLowerCase()];
  if (fromMime) return fromMime;
  const namePart = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  if (/^[a-z0-9]{1,10}$/.test(namePart)) return namePart;
  return "bin";
}

function updateDataForKind(kind: PrivateFileKind, key: string) {
  switch (kind) {
    case "photo":
      return { photoKey: key };
    case "id_proof":
      return { idProofKey: key };
    case "waiver":
      return { waiverSignatureKey: key, waiverAcceptedAt: new Date() };
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ memberId: string }> },
): Promise<NextResponse> {
  try {
    const { memberId } = await context.params;
    const formData = await request.formData();

    const gymSlugRaw = formData.get("gymSlug");
    const kindRaw = formData.get("kind");
    const file = formData.get("file");

    const gymSlug = typeof gymSlugRaw === "string" ? gymSlugRaw.trim() : "";
    const kind = typeof kindRaw === "string" ? kindRaw.trim() : "";

    if (!gymSlug) {
      throw new ValidationFailedError("gymSlug is required.", { gymSlug: ["Required."] });
    }
    if (!isPrivateFileKind(kind)) {
      throw new ValidationFailedError("kind must be photo, id_proof, or waiver.", {
        kind: ["Invalid file kind."],
      });
    }
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationFailedError("A non-empty file is required.", {
        file: ["Select a file to upload."],
      });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationFailedError("File exceeds the 10 MB limit.", {
        file: ["Max size is 10 MB."],
      });
    }

    const result = await withTenant(gymSlug, "member:write", async (ctx) => {
      const member = await ctx.db.memberProfile.findUnique({
        where: { id: memberId },
        select: { id: true },
      });
      if (!member) {
        throw new NotFoundError("Member");
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const { key } = await savePrivateFile({
        gymId: ctx.gym.id,
        memberId: member.id,
        kind,
        bytes,
        contentType: file.type || "application/octet-stream",
        ext: resolveFileExtension(file),
      });

      await ctx.db.memberProfile.update({
        where: { id: member.id },
        data: updateDataForKind(kind, key),
      });

      await auditInContext({
        action: "member.file_upload",
        entityType: "MemberProfile",
        entityId: member.id,
        after: { kind, key },
      });

      return { key, kind };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.expose ? error.message : "Request failed.", code: error.code },
        { status: error.status },
      );
    }
    console.error("[api:member-upload]", error);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
}
