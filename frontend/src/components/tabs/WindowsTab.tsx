import { useState, useEffect } from "react";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import TextFilter from "@cloudscape-design/components/text-filter";
import Button from "@cloudscape-design/components/button";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { apiUrl } from "../../lib/api";
import { fmtDateTime } from "../../lib/utils";
import { prettyAppLabel } from "../../lib/app-names";
import { AppIcon } from "../common/AppIcon";

interface WindowEvent {
  id: number;
  window_title: string;
  exe_name: string;
  app_display?: string;
  timestamp: string;
}

interface TopWindowRow {
  app: string;
  app_display?: string;
  title: string;
  focus_count: number;
  last_ts: string;
}

interface WindowsTabProps {
  agentId: string;
}

export function WindowsTab({ agentId }: WindowsTabProps) {
  const [items, setItems] = useState<WindowEvent[]>([]);
  const [topItems, setTopItems] = useState<TopWindowRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWindows();
  }, [agentId]);

  const fetchWindows = async () => {
    try {
      setLoading(true);
      const response = await fetch(apiUrl(`/agents/${agentId}/windows?limit=500`), {
        credentials: "include",
      });
      
      if (response.ok) {
        const data = await response.json();
        const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
        setItems(
          rows.map((row: any) => ({
            id: row.id ?? row.hwnd ?? 0,
            window_title: row.window_title ?? row.title ?? "—",
            exe_name: row.exe_name ?? row.app ?? "—",
            app_display: row.app_display ?? row.exe_name ?? row.app ?? "—",
            timestamp: row.timestamp ?? row.ts ?? row.created ?? "",
          }))
        );
      }

      const topRes = await fetch(apiUrl(`/agents/${agentId}/top-windows?limit=20`), {
        credentials: "include",
      });
      if (topRes.ok) {
        const topData = await topRes.json();
        const topRows = Array.isArray(topData?.rows) ? topData.rows : [];
        setTopItems(
          topRows.map((row: any) => ({
            app: row.app ?? "",
            app_display: row.app_display ?? row.app ?? "",
            title: row.title ?? "",
            focus_count: row.focus_count ?? 0,
            last_ts: row.last_ts ?? "",
          }))
        );
      }
    } catch (err) {
      console.error("Failed to fetch windows:", err);
    } finally {
      setLoading(false);
    }
  };

  const { items: displayItems, collectionProps, filterProps, paginationProps } = useCollection(
    items,
    {
      filtering: {
        empty: "No windows found",
        noMatch: "No windows match the filter",
        filteringFunction: (item, filteringText) => {
          const searchText = filteringText.toLowerCase();
          return (
              (item.app_display || "").toLowerCase().includes(searchText) ||
            (item.exe_name || "").toLowerCase().includes(searchText) ||
            (item.window_title || "").toLowerCase().includes(searchText)
          );
        },
      },
      pagination: { pageSize: 50 },
      sorting: {
        defaultState: {
          sortingColumn: { sortingField: "timestamp" },
          isDescending: true,
        },
      },
    }
  );

  return (
    <Table
      {...collectionProps}
      loading={loading}
      loadingText="Loading windows..."
      columnDefinitions={[
        {
          id: "timestamp",
          header: "Time",
          cell: (item) => fmtDateTime(item.timestamp),
          sortingField: "timestamp",
          width: 180,
        },
        {
          id: "app",
          header: "Application",
          cell: (item) => (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <AppIcon agentId={agentId} exeName={item.exe_name} size={16} />
                <span>{prettyAppLabel({ exeName: item.exe_name, appDisplay: item.app_display })}</span>
              </div>
              <Box className="sentinel-monospace" fontSize="body-s" color="text-body-secondary">
                {item.exe_name}
              </Box>
            </div>
          ),
          sortingField: "exe_name",
          width: 200,
        },
        {
          id: "window",
          header: "Window Title",
          cell: (item) => item.window_title || "—",
          sortingField: "window_title",
        },
      ]}
      items={displayItems}
      variant="container"
      stickyHeader
      header={
        <Header
          counter={`(${items.length})`}
          actions={
            <Button iconName="refresh" onClick={fetchWindows}>
              Refresh
            </Button>
          }
          description={
            topItems.length > 0
              ? `Top windows retained long-term: ${topItems
                  .slice(0, 2)
                  .map((t) => `${prettyAppLabel({ exeName: t.app, appDisplay: t.app_display })} (${t.focus_count})`)
                  .join(" • ")}`
              : "Top window aggregates are retained after raw windows retention expiry."
          }
        >
          Window Focus History
        </Header>
      }
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Search by app or window title"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" color="inherit">
          <Box variant="p" color="inherit">
            No window focus events recorded
          </Box>
        </Box>
      }
    />
  );
}
