import { z } from "zod";

export const checkInSchema = z.object({
  gymSlug: z.string().min(1),
  memberId: z.string().min(1, "Select a member."),
  source: z.enum(["MANUAL", "STAFF_SCAN", "MEMBER_QR"]).default("MANUAL"),
});

export const checkOutSchema = z.object({
  gymSlug: z.string().min(1),
  attendanceId: z.string().min(1),
});
