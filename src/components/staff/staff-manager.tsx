"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mail, Trash2, UserPlus, X } from "lucide-react";
import type { z } from "zod";
import {
  addOrInviteStaffAction,
  removeStaffAction,
  updateStaffRoleAction,
} from "@/server/staff/actions";
import {
  STAFF_ROLES,
  inviteStaffInputSchema,
  type InviteStaffFormInput,
  type InviteStaffParsedInput,
  type StaffRole,
} from "@/server/staff/schemas";
import type { StaffDTO } from "@/server/services/staff";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

type Props = {
  gymSlug: string;
  currentUserId: string;
  canWrite: boolean;
  initialStaff: StaffDTO[];
};

const ROLE_LABELS: Record<StaffRole, string> = {
  GYM_OWNER: "Owner",
  STAFF: "Staff",
  TRAINER: "Trainer",
};

const EMPTY_DEFAULTS: InviteStaffFormInput = {
  name: "",
  email: "",
  role: "STAFF",
};

export function StaffManager({ gymSlug, currentUserId, canWrite, initialStaff }: Props) {
  const [staff, setStaff] = useState<StaffDTO[]>(initialStaff);
  const [formOpen, setFormOpen] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof inviteStaffInputSchema>, unknown, InviteStaffParsedInput>({
    resolver: zodResolver(inviteStaffInputSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  function openInvite() {
    setBanner(null);
    reset(EMPTY_DEFAULTS);
    setFormOpen(true);
  }

  function closeInvite() {
    setFormOpen(false);
    reset(EMPTY_DEFAULTS);
  }

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    const result = await addOrInviteStaffAction({ ...values, gymSlug });

    if (!result.ok) {
      if (result.error.fieldErrors) {
        for (const [field, msgs] of Object.entries(result.error.fieldErrors)) {
          if (msgs[0]) setError(field as keyof InviteStaffFormInput, { message: msgs[0] });
        }
      }
      setBanner({ tone: "error", text: result.error.message });
      return;
    }

    const { staff: added, invited } = result.data;
    setStaff((prev) => {
      const exists = prev.some((item) => item.membershipId === added.membershipId);
      return exists
        ? prev.map((item) => (item.membershipId === added.membershipId ? added : item))
        : [...prev, added];
    });
    setBanner({
      tone: "success",
      text: invited
        ? `Invite sent to ${added.email}. They can set their password using the email link.`
        : `${added.name} (${added.email}) was added to the team.`,
    });
    closeInvite();
  });

  async function handleRoleChange(member: StaffDTO, nextRole: StaffRole) {
    if (nextRole === member.role) return;
    setBusyId(member.membershipId);
    setBanner(null);
    const result = await updateStaffRoleAction({
      gymSlug,
      membershipId: member.membershipId,
      role: nextRole,
    });
    setBusyId(null);

    if (!result.ok) {
      setBanner({ tone: "error", text: result.error.message });
      return;
    }

    setStaff((prev) =>
      prev.map((item) => (item.membershipId === result.data.membershipId ? result.data : item)),
    );
    setBanner({
      tone: "success",
      text: `Updated ${result.data.name}'s role to ${ROLE_LABELS[result.data.role]}.`,
    });
  }

  async function handleRemove(member: StaffDTO) {
    setBusyId(member.membershipId);
    setBanner(null);
    const result = await removeStaffAction({
      gymSlug,
      membershipId: member.membershipId,
    });
    setBusyId(null);

    if (!result.ok) {
      setBanner({ tone: "error", text: result.error.message });
      return;
    }

    setStaff((prev) => prev.filter((item) => item.membershipId !== result.data.membershipId));
    setBanner({
      tone: "success",
      text: `Removed ${member.name} from staff.`,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Staff & trainers</h2>
          <p className="text-sm text-muted-foreground">
            Invite team members and manage their access to this gym.
          </p>
        </div>
        {canWrite && !formOpen ? (
          <Button onClick={openInvite} className="shrink-0">
            <UserPlus className="h-4 w-4" />
            Invite staff
          </Button>
        ) : null}
      </div>

      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}

      {formOpen && canWrite ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Add or invite staff member</CardTitle>
            <Button type="button" variant="ghost" size="icon" onClick={closeInvite} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription className="mt-1">
            Existing users are added immediately. New users receive an email invite to set a password.
          </CardDescription>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Full name" htmlFor="staff-name" error={errors.name?.message}>
                <Input
                  id="staff-name"
                  placeholder="Aarav Sharma"
                  aria-invalid={Boolean(errors.name)}
                  {...register("name")}
                />
              </Field>

              <Field label="Email" htmlFor="staff-email" error={errors.email?.message}>
                <Input
                  id="staff-email"
                  type="email"
                  placeholder="aarav@example.com"
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
              </Field>

              <Field label="Role" htmlFor="staff-role" error={errors.role?.message}>
                <select
                  id="staff-role"
                  className="flex h-11 w-full rounded-lg border bg-card px-3 py-2 text-base shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                  aria-invalid={Boolean(errors.role)}
                  {...register("role")}
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeInvite}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Add / send invite
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {staff.length === 0 ? (
        <Card>
          <CardTitle className="text-base">No staff members yet</CardTitle>
          <CardDescription className="mt-1">
            Invite front-desk staff, trainers, or co-owners to collaborate.
          </CardDescription>
        </Card>
      ) : (
        <div className="space-y-3">
          {staff.map((member) => {
            const isSelf = member.userId === currentUserId;
            const isBusy = busyId === member.membershipId;

            return (
              <Card
                key={member.membershipId}
                className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{member.name}</span>
                    <Badge>{ROLE_LABELS[member.role]}</Badge>
                    {isSelf ? <Badge className="bg-primary/10 text-primary">You</Badge> : null}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                </div>

                {canWrite ? (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Role for ${member.name}`}
                      disabled={isBusy}
                      value={member.role}
                      onChange={(e) => handleRoleChange(member, e.target.value as StaffRole)}
                      className="h-9 rounded-lg border bg-card px-2.5 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {STAFF_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy || isSelf}
                      title={isSelf ? "You cannot remove yourself" : `Remove ${member.name}`}
                      onClick={() => handleRemove(member)}
                    >
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      <span className="sr-only sm:not-sr-only">Remove</span>
                    </Button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
