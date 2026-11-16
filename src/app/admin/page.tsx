import { redirect } from "next/navigation";
import { AdminGymsPanel } from "@/components/admin/admin-gyms-panel";
import { AppHeader } from "@/components/app/header";
import { Alert } from "@/components/ui/card";
import { getCurrentSession } from "@/server/auth/session";
import { listAllGymsForAdmin } from "@/server/services/saas";

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login?next=/admin");
  }

  const isSuperAdmin = session.user.platformRole === "SUPER_ADMIN";

  if (!isSuperAdmin) {
    return (
      <>
        <AppHeader
          title="Super-Admin Console"
          subtitle="Platform administration"
          role={session.user.platformRole}
          user={session.user}
        />
        <main className="mx-auto max-w-5xl px-5 py-6">
          <Alert tone="error">
            Forbidden: Platform administrator access (SUPER_ADMIN) is required to view this page.
          </Alert>
        </main>
      </>
    );
  }

  const gyms = await listAllGymsForAdmin();

  return (
    <>
      <AppHeader
        title="Super-Admin Console"
        subtitle="Platform administration · All gyms"
        role={session.user.platformRole}
        user={session.user}
      />
      <main className="mx-auto max-w-5xl px-5 py-6 pb-20 sm:pb-6">
        <AdminGymsPanel initialGyms={gyms} />
      </main>
    </>
  );
}
