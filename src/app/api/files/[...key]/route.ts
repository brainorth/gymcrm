import { NextResponse } from "next/server";
import { can } from "@/server/auth/rbac";
import { getCurrentSession } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { AppError } from "@/server/db/errors";
import { readPrivateFile } from "@/server/storage/files";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "You must sign in to continue." }, { status: 401 });
    }

    const { key: segments } = await context.params;
    if (!Array.isArray(segments) || segments.length < 3) {
      return NextResponse.json({ error: "Invalid file key." }, { status: 400 });
    }

    const [gymId, memberId] = segments;
    if (!gymId || !memberId) {
      return NextResponse.json({ error: "Invalid file key." }, { status: 400 });
    }

    const isSuperAdmin = session.user.platformRole === "SUPER_ADMIN";
    if (!isSuperAdmin) {
      const membership = session.user.memberships.find((m) => m.gymId === gymId);
      if (!membership) {
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      }

      if (!can(membership.role, "member:read")) {
        if (membership.role !== "MEMBER") {
          return NextResponse.json({ error: "Forbidden." }, { status: 403 });
        }
        const ownProfile = await prisma.memberProfile.findFirst({
          where: { id: memberId, gymId, userId: session.user.id },
          select: { id: true },
        });
        if (!ownProfile) {
          return NextResponse.json({ error: "Forbidden." }, { status: 403 });
        }
      }
    }

    const joinedKey = segments.join("/");
    const { bytes, contentType } = await readPrivateFile(joinedKey);

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.expose ? error.message : "Request failed.", code: error.code },
        { status: error.status },
      );
    }
    console.error("[api:files]", error);
    return NextResponse.json({ error: "Failed to read file." }, { status: 500 });
  }
}
