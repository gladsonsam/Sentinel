import { useCallback, useEffect, useState } from "react";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import TextFilter from "@cloudscape-design/components/text-filter";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Toggle from "@cloudscape-design/components/toggle";
import Button from "@cloudscape-design/components/button";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { apiUrl } from "../../lib/api";
import { fmtDateTime } from "../../lib/utils";
import { prettyAppLabel } from "../../lib/app-names";
import { AppIcon } from "../common/AppIcon";

interface KeystrokeEvent {
  id: number;
  exe_name: string;
  app_display?: string;
  window_title: string;
  keys: string;
  timestamp: string;
}

interface KeysTabProps {
  agentId: string;
}

export function KeysTab({ agentId }: KeysTabProps) {
  const [items, setItems] = useState<KeystrokeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCorrected, setShowCorrected] = useState(false);

  const fetchKeystrokes = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(apiUrl(`/agents/${agentId}/keys?limit=500`), {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
        setItems(
          rows.map((row: Record<string, unknown>) => ({
            id: Number(row.id ?? 0),
            exe_name: String(row.exe_name ?? row.app ?? "—"),
            app_display: String(row.app_display ?? row.exe_name ?? row.app ?? "—"),
            window_title: String(row.window_title ?? row.title ?? "—"),
            keys: String(row.keys ?? row.text ?? ""),
            timestamp: String(row.timestamp ?? row.updated_at ?? row.started_at ?? ""),
          }))
        );
      }
    } catch (err) {
      console.error("Failed to fetch keystrokes:", err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchKeystrokes();
  }, [fetchKeystrokes]);

  const applyBackspaceCorrection = (text: string): string => {
    const stack: string[] = [];
    let i = 0;
    
    while (i < text.length) {
      if (text.startsWith("[⌫]", i)) {
        if (stack.length > 0) stack.pop();
        i += 3;
      } else if (text.startsWith("[Del]", i)) {
        i += 5;
      } else {
        stack.push(text[i]);
        i++;
      }
    }
    
    return stack.join("");
  };

  const { items: displayItems, collectionProps, filterProps, paginationProps } = useCollection(
    items,
    {
      filtering: {
        empty: "No keystrokes found",
        noMatch: "No keystrokes match the filter",
        filteringFunction: (item, filteringText) => {
          const searchText = filteringText.toLowerCase();
          return (
            (item.app_display || "").toLowerCase().includes(searchText) ||
            (item.exe_name || "").toLowerCase().includes(searchText) ||
            (item.window_title || "").toLowerCase().includes(searchText) ||
            (item.keys || "").toLowerCase().includes(searchText)
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
      loadingText="Loading keystrokes..."
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
                <button
                  type="button"
                  onClick={() =>
                    filterProps.onChange({
                      detail: { filteringText: item.exe_name ?? "" },
                    } as Parameters<typeof filterProps.onChange>[0])
                  }
                  title="Filter table by this app"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "inherit",
                    textAlign: "left",
                    font: "inherit",
                  }}
                >
                  {prettyAppLabel({ exeName: item.exe_name, appDisplay: item.app_display })}
                </button>
              </div>
              <Box className="sentinel-monospace" fontSize="body-s" color="text-body-secondary">
                {item.exe_name}
              </Box>
            </div>
          ),
          sortingField: "exe_name",
          width: 150,
        },
        {
          id: "window",
          header: "Window",
          cell: (item) => (
            <Box fontSize="body-s">{item.window_title}</Box>
          ),
          sortingField: "window_title",
        },
        {
          id: "keys",
          header: "Keystrokes",
          cell: (item) => (
            <Box className="sentinel-monospace" fontSize="body-s">
              {showCorrected ? applyBackspaceCorrection(item.keys || "") : item.keys || ""}
            </Box>
          ),
        },
      ]}
      items={displayItems}
      variant="container"
      stickyHeader
      header={
        <Header
          counter={`(${items.length})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <Toggle
                checked={showCorrected}
                onChange={({ detail }) => setShowCorrected(detail.checked)}
              >
                Show corrected
              </Toggle>
              <Button iconName="refresh" onClick={fetchKeystrokes}>
                Refresh
              </Button>
            </SpaceBetween>
          }
        >
          Keystrokes
        </Header>
      }
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Search by app, window, or text"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" color="inherit">
          <Box variant="p" color="inherit">
            No keystrokes recorded
          </Box>
        </Box>
      }
    />
  );
}
