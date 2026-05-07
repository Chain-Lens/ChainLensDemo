"use client";

import { useMemo, useState } from "react";
import { useAdmin } from "@/hooks/useAdmin";
import { useAdminAllApis } from "@/hooks/useAdminAllApis";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import AdminLoginGate from "@/components/admin/AdminLoginGate";
import AdminConsoleHeader from "@/components/admin/AdminConsoleHeader";
import AdminStatRow from "@/components/admin/AdminStatRow";
import AdminTabs, { type AdminTab } from "@/components/admin/AdminTabs";
import PendingTab from "@/components/admin/PendingTab";
import AllApisTab from "@/components/admin/AllApisTab";
import SellersTab from "@/components/admin/SellersTab";
import TreasuryTab from "@/components/admin/TreasuryTab";

export default function AdminPage() {
  const auth = useAdminAuth();
  const admin = useAdmin();
  const allApis = useAdminAllApis(auth.isAuthenticated);
  const [activeTab, setActiveTab] = useState<AdminTab>("pending");

  const apiSummary = useMemo(() => {
    const rows = allApis.apis;
    return {
      total: rows.length,
      pending: rows.filter((api) => api.status === "PENDING").length,
      approved: rows.filter((api) => api.status === "APPROVED").length,
      rejected: rows.filter((api) => api.status === "REJECTED").length,
    };
  }, [allApis.apis]);

  if (!auth.isAuthenticated) {
    return <AdminLoginGate loading={auth.loading} error={auth.error} onSignIn={auth.signIn} />;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <AdminConsoleHeader onSignOut={auth.signOut} />
      <AdminStatRow {...apiSummary} />
      <AdminTabs active={activeTab} onChange={setActiveTab} />

      {activeTab === "pending" && (
        <PendingTab
          loading={admin.loading}
          error={admin.error}
          apis={admin.pendingApis}
          onApprove={async (id, reason) => {
            await admin.approve(id, reason);
            allApis.refetch();
          }}
          onReject={async (id, reason) => {
            await admin.reject(id, reason);
            allApis.refetch();
          }}
          onRunTest={admin.testApi}
        />
      )}
      {activeTab === "apis" && (
        <AllApisTab loading={allApis.loading} error={allApis.error} apis={allApis.apis} />
      )}
      {activeTab === "sellers" && <SellersTab enabled={activeTab === "sellers"} />}
      {activeTab === "treasury" && <TreasuryTab />}
    </main>
  );
}
