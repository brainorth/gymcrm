"use client";

import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Phone,
  RotateCcw,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import type { z } from "zod";
import type { MemberStatus } from "@/generated/prisma/client";
import {
  createMemberAction,
  setMemberStatusAction,
  updateMemberAction,
} from "@/server/members/actions";
import {
  memberInputSchema,
  type MemberFormInput,
  type MemberParsedInput,
} from "@/server/members/schemas";
import type { MemberDTO } from "@/server/services/members";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";

type Props = {
  gymSlug: string;
  canWrite: boolean;
  canArchive: boolean;
  initialMembers: MemberDTO[];
};

const EMPTY_DEFAULTS: MemberFormInput = {
  fullName: "",
  phone: "",
  email: "",
  dateOfBirth: "",
  gender: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelation: "",
  notes: "",
};

const STATUS_TABS: Array<{ value: MemberStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "ARCHIVED", label: "Archived" },
];

export function MembersManager({ gymSlug, canWrite, canArchive, initialMembers }: Props) {
  const [members, setMembers] = useState<MemberDTO[]>(initialMembers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MemberStatus | "ALL">("ACTIVE");
  const [formOpen, setFormOpen] = useState(false);
  const [showMoreFields, setShowMoreFields] = useState(false);
  const [editing, setEditing] = useState<MemberDTO | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof memberInputSchema>, unknown, MemberParsedInput>({
    resolver: zodResolver(memberInputSchema),
    defaultValues: EMPTY_DEFAULTS,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (statusFilter !== "ALL" && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        m.fullName.toLowerCase().includes(q) ||
        m.phone.toLowerCase().includes(q) ||
        m.memberCode.toLowerCase().includes(q)
      );
    });
  }, [members, search, statusFilter]);

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setShowMoreFields(false);
    reset(EMPTY_DEFAULTS);
    setFormOpen(true);
  }

  function openEdit(member: MemberDTO) {
    setEditing(member);
    setFormError(null);
    setShowMoreFields(
      Boolean(
        member.email ||
          member.dateOfBirth ||
          member.gender ||
          member.emergencyContactName ||
          member.emergencyContactPhone ||
          member.notes,
      ),
    );
    reset({
      fullName: member.fullName,
      phone: member.phone,
      email: member.email ?? "",
      dateOfBirth: member.dateOfBirth ?? "",
      gender: member.gender ?? "",
      emergencyContactName: member.emergencyContactName ?? "",
      emergencyContactPhone: member.emergencyContactPhone ?? "",
      emergencyContactRelation: member.emergencyContactRelation ?? "",
      notes: member.notes ?? "",
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setFormError(null);
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const result = editing
      ? await updateMemberAction({ ...values, gymSlug, memberId: editing.id })
      : await createMemberAction({ ...values, gymSlug });

    if (!result.ok) {
      if (result.error.fieldErrors) {
        for (const [field, msgs] of Object.entries(result.error.fieldErrors)) {
          if (msgs[0]) setError(field as keyof MemberFormInput, { message: msgs[0] });
        }
      }
      setFormError(result.error.message);
      return;
    }

    const saved = result.data;
    setMembers((prev) =>
      editing ? prev.map((m) => (m.id === saved.id ? saved : m)) : [saved, ...prev],
    );
    closeForm();
  });

  async function handleStatusChange(member: MemberDTO, status: MemberStatus) {
    setBusyId(member.id);
    setFormError(null);
    const result = await setMemberStatusAction({
      gymSlug,
      memberId: member.id,
      status,
    });
    setBusyId(null);

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }
    setMembers((prev) => prev.map((m) => (m.id === result.data.id ? result.data : m)));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Members</h2>
          <p className="text-sm text-muted-foreground">
            {members.filter((m) => m.status === "ACTIVE").length} active · {members.length} total
          </p>
        </div>
        {canWrite && !formOpen ? (
          <Button onClick={openCreate} className="shrink-0">
            <UserPlus className="h-4 w-4" />
            Add member
          </Button>
        ) : null}
      </div>

      {formError && !formOpen ? <Alert tone="error">{formError}</Alert> : null}

      {formOpen && canWrite ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">
              {editing ? `Edit ${editing.fullName}` : "New member"}
            </CardTitle>
            <Button type="button" variant="ghost" size="icon" onClick={closeForm} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            {formError ? <Alert tone="error">{formError}</Alert> : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="member-name" error={errors.fullName?.message}>
                <Input id="member-name" placeholder="e.g. Rahul Sharma" {...register("fullName")} />
              </Field>

              <Field label="Phone number" htmlFor="member-phone" error={errors.phone?.message}>
                <Input
                  id="member-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="+91 9876543210"
                  {...register("phone")}
                />
              </Field>
            </div>

            <button
              type="button"
              onClick={() => setShowMoreFields((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              {showMoreFields ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" /> Hide optional details
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" /> Add email, DOB, emergency contact & notes
                </>
              )}
            </button>

            {showMoreFields ? (
              <div className="space-y-4 border-t pt-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Email (optional)" htmlFor="member-email" error={errors.email?.message}>
                    <Input
                      id="member-email"
                      type="email"
                      placeholder="rahul@example.com"
                      {...register("email")}
                    />
                  </Field>

                  <Field
                    label="Date of birth"
                    htmlFor="member-dob"
                    error={errors.dateOfBirth?.message}
                  >
                    <Input id="member-dob" type="date" {...register("dateOfBirth")} />
                  </Field>

                  <Field label="Gender" htmlFor="member-gender" error={errors.gender?.message}>
                    <Input
                      id="member-gender"
                      placeholder="Male / Female / Other"
                      {...register("gender")}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field
                    label="Emergency contact"
                    htmlFor="member-ec-name"
                    error={errors.emergencyContactName?.message}
                  >
                    <Input
                      id="member-ec-name"
                      placeholder="Contact name"
                      {...register("emergencyContactName")}
                    />
                  </Field>

                  <Field
                    label="Emergency phone"
                    htmlFor="member-ec-phone"
                    error={errors.emergencyContactPhone?.message}
                  >
                    <Input
                      id="member-ec-phone"
                      type="tel"
                      inputMode="tel"
                      placeholder="+91 9876543210"
                      {...register("emergencyContactPhone")}
                    />
                  </Field>

                  <Field
                    label="Relation"
                    htmlFor="member-ec-rel"
                    error={errors.emergencyContactRelation?.message}
                  >
                    <Input
                      id="member-ec-rel"
                      placeholder="Parent / Spouse"
                      {...register("emergencyContactRelation")}
                    />
                  </Field>
                </div>

                <Field label="Notes" htmlFor="member-notes" error={errors.notes?.message}>
                  <Input
                    id="member-notes"
                    placeholder="Medical notes, goals, preferred slot..."
                    {...register("notes")}
                  />
                </Field>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editing ? "Save changes" : "Add member"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or ID..."
            className="pl-9"
            aria-label="Search members"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.value}
              type="button"
              size="sm"
              variant={statusFilter === tab.value ? "default" : "outline"}
              onClick={() => setStatusFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardTitle className="text-base">No matching members</CardTitle>
          <CardDescription className="mt-1">
            {members.length === 0
              ? "Tap “Add member” to register your first walk-in member."
              : "Try clearing your search or switching the status filter."}
          </CardDescription>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((member) => (
            <Card key={member.id} className={member.status === "ARCHIVED" ? "opacity-65" : ""}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="truncate text-base">{member.fullName}</CardTitle>
                    <Badge>{member.status.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{member.memberCode}</p>
                </div>
                {member.activeSubscriptionEndDate ? (
                  <Badge className="shrink-0">Valid till {member.activeSubscriptionEndDate}</Badge>
                ) : (
                  <Badge className="shrink-0">No plan</Badge>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <a
                  href={`tel:${member.phone}`}
                  className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {member.phone}
                </a>
                {member.email ? (
                  <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                ) : null}
              </div>

              {canWrite || canArchive ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(member)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  ) : null}
                  {canArchive ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyId === member.id}
                      onClick={() =>
                        handleStatusChange(
                          member,
                          member.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED",
                        )
                      }
                    >
                      {busyId === member.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : member.status === "ARCHIVED" ? (
                        <RotateCcw className="h-3.5 w-3.5" />
                      ) : (
                        <Archive className="h-3.5 w-3.5" />
                      )}
                      {member.status === "ARCHIVED" ? "Restore" : "Archive"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
