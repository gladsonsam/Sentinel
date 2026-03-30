import { useEffect, useMemo, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { apiUrl } from "../../lib/api";
import { fmtDateTime } from "../../lib/utils";
import { AuditStatusBadge } from "../common/AuditStatusBadge";

interface AuditRow {
  id: number;
  ts: string;
  actor: string;
  client_ip?: string | null;
  agent_id: string | null;
  action: string;
  status: "ok" | "error" | "rejected" | string;
  detail: Record<string, unknown>;
}

interface AuditTabProps {
  /** When set, only rows for this agent (same API as global log). */
  agentId?: string;
  /** Narrow global log: authentication-only vs operator/API (ignored when `agentId` is set). */
  scope?: "all" | "auth" | "operator";
  /** Colour-code status column (green / yellow / red tiers). Default true. */
  colorizeStatus?: boolean;
  /** Table header title (default: Audit log). */
  title?: string;
  /** Shown above the table. */
  subheader?: string;
}

const STATUS_OPTIONS = [
  { label: "All statuses", value: "all" },
  { label: "OK", value: "ok" },
  { label: "Error", value: "error" },
  { label: "Rejected", value: "rejected" },
];

export function AuditTab({
  agentId,
  scope = "all",
  colorizeStatus = true,
  title = "Audit log",
  subheader,
}: AuditTabProps) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(STATUS_OPTIONS[0]);

  const fetchAudit = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("limit", "500");
      if (agentId) params.set("agent_id", agentId);
      if (statusFilter.value !== "all") params.set("status", statusFilter.value!);
      const response = await fetch(apiUrl(`/audit?${params.toString()}`), {
        credentials: "include",
      });
      if (!response.ok) return;

      const data = await response.json();
      const list = Array.isArray(data?.rows) ? data.rows : [];
      setRows(
        list.map((r: any) => ({
          id: r.id ?? 0,
          ts: r.ts ?? r.timestamp ?? "",
          actor: r.actor ?? "operator",
          client_ip: r.client_ip ?? null,
          agent_id: r.agent_id ?? null,
          action: r.action ?? "unknown",
          status: r.status ?? "ok",
          detail: r.detail ?? {},
        }))
      );
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
  }, [agentId, statusFilter.value]);

  const scopedRows = useMemo(() => {
    if (agentId) return rows;
    if (scope === "auth") return rows.filter((r) => r.actor === "auth");
    if (scope === "operator") return rows.filter((r) => r.actor !== "auth");
    return rows;
  }, [rows, scope, agentId]);

  const { items, collectionProps, filterProps, paginationProps } = useCollection(scopedRows, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const q = filteringText.toLowerCase();
        return (
          (item.action || "").toLowerCase().includes(q) ||
          (item.status || "").toLowerCase().includes(q) ||
          (item.actor || "").toLowerCase().includes(q) ||
          (item.client_ip || "").toLowerCase().includes(q) ||
          JSON.stringify(item.detail || {}).toLowerCase().includes(q)
        );
      },
      empty: "No audit records",
      noMatch: "No audit records match the current filters",
    },
    sorting: {
      defaultState: {
        sortingColumn: { sortingField: "ts" },
        isDescending: true,
      },
    },
    pagination: { pageSize: 50 },
  });

  return (
    <SpaceBetween size="m">
      {subheader ? (
        <Box fontSize="body-s" color="text-body-secondary">
          {subheader}
        </Box>
      ) : null}
      <Table
      {...collectionProps}
      loading={loading}
      loadingText="Loading audit log..."
      items={items}
      variant="container"
      stickyHeader
      columnDefinitions={[
        {
          id: "ts",
          header: "Time",
          cell: (item) => fmtDateTime(item.ts),
          sortingField: "ts",
          width: 190,
        },
        {
          id: "action",
          header: "Action",
          cell: (item) => item.action,
          sortingField: "action",
          width: 180,
        },
        {
          id: "status",
          header: "Status",
          cell: (item) =>
            colorizeStatus ? (
              <AuditStatusBadge status={item.status} />
            ) : (
              item.status
            ),
          sortingField: "status",
          width: 120,
        },
        {
          id: "user",
          header: "User",
          cell: (item) => item.actor,
          sortingField: "actor",
          width: 120,
        },
        {
          id: "client_ip",
          header: "IP",
          cell: (item) => item.client_ip || "—",
          sortingField: "client_ip",
          width: 140,
        },
        {
          id: "detail",
          header: "Details",
          cell: (item) => (
            <Box fontSize="body-s" color="text-body-secondary">
              {JSON.stringify(item.detail)}
            </Box>
          ),
        },
      ]}
      header={
        <Header
          counter={`(${scopedRows.length})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Select
                selectedOption={statusFilter}
                onChange={({ detail }) =>
                  setStatusFilter(
                    (detail.selectedOption as typeof STATUS_OPTIONS[number]) || STATUS_OPTIONS[0]
                  )
                }
                options={STATUS_OPTIONS}
              />
              <Button iconName="refresh" onClick={fetchAudit}>
                Refresh
              </Button>
            </SpaceBetween>
          }
        >
          {title}
        </Header>
      }
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Search action, status, user, IP, or detail JSON"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center">
          <Box variant="p" color="text-body-secondary">
            No audit records yet
          </Box>
        </Box>
      }
    />
    </SpaceBetween>
  );
}
