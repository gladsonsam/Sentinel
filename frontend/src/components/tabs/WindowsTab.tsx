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

interface WindowEvent {
  id: number;
  window_title: string;
  exe_name: string;
  timestamp: string;
}

interface WindowsTabProps {
  agentId: string;
}

export function WindowsTab({ agentId }: WindowsTabProps) {
  const [items, setItems] = useState<WindowEvent[]>([]);
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
            timestamp: row.timestamp ?? row.ts ?? row.created ?? "",
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
          cell: (item) => item.exe_name || "—",
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
