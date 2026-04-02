import { useCallback, useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { apiUrl } from "../../lib/api";
import { fmtDateTime } from "../../lib/utils";

interface AlertRuleEventRow {
  id: number;
  rule_id: number | null;
  rule_name: string;
  channel: "url" | "keys" | string;
  snippet: string;
  created_at: string;
}

interface AlertsTabProps {
  agentId: string;
}

export function AlertsTab({ agentId }: AlertsTabProps) {
  const [items, setItems] = useState<AlertRuleEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        apiUrl(`/agents/${agentId}/alert-rule-events?limit=500&offset=0`),
        { credentials: "include" }
      );
      if (!response.ok) {
        setItems([]);
        return;
      }
      const data = await response.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setItems(
        rows.map((row: Record<string, unknown>) => ({
          id: Number(row.id ?? 0),
          rule_id: row.rule_id != null ? Number(row.rule_id) : null,
          rule_name: String(row.rule_name ?? ""),
          channel: String(row.channel ?? ""),
          snippet: String(row.snippet ?? ""),
          created_at: String(row.created_at ?? ""),
        }))
      );
    } catch (err) {
      console.error("Failed to fetch alert rule events:", err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const { items: displayItems, collectionProps, filterProps, paginationProps } = useCollection(
    items,
    {
      filtering: {
        empty: "No alert matches yet",
        noMatch: "No rows match the filter",
        filteringFunction: (item, filteringText) => {
          const q = filteringText.toLowerCase();
          return (
            (item.rule_name || "").toLowerCase().includes(q) ||
            (item.snippet || "").toLowerCase().includes(q) ||
            (item.channel || "").toLowerCase().includes(q)
          );
        },
      },
      pagination: { pageSize: 25 },
      sorting: {
        defaultState: {
          sortingColumn: { sortingField: "created_at" },
          isDescending: true,
        },
      },
    }
  );

  return (
    <Table
      {...collectionProps}
      loading={loading}
      loadingText="Loading alert history…"
      columnDefinitions={[
        {
          id: "created_at",
          header: "Time",
          cell: (item) => fmtDateTime(item.created_at),
          sortingField: "created_at",
          width: 180,
        },
        {
          id: "rule_name",
          header: "Rule",
          cell: (item) => item.rule_name || "—",
          sortingField: "rule_name",
          width: 200,
        },
        {
          id: "channel",
          header: "Channel",
          cell: (item) => (
            <Box fontSize="body-s">
              {item.channel === "url" ? "URL" : item.channel === "keys" ? "Keys" : item.channel}
            </Box>
          ),
          sortingField: "channel",
          width: 90,
        },
        {
          id: "snippet",
          header: "Matched text",
          cell: (item) => (
            <Box className="sentinel-monospace" fontSize="body-s">
              {item.snippet || "—"}
            </Box>
          ),
        },
        {
          id: "rule_id",
          header: "Rule ID",
          cell: (item) => (item.rule_id != null ? String(item.rule_id) : "—"),
          sortingField: "rule_id",
          width: 100,
        },
      ]}
      items={displayItems}
      variant="container"
      stickyHeader
      header={
        <Header
          counter={`(${items.length})`}
          actions={
            <Button iconName="refresh" onClick={fetchEvents}>
              Refresh
            </Button>
          }
        >
          Alert notifications
        </Header>
      }
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Search by rule name, channel, or matched text"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="m">
            <Box variant="p" color="inherit">
              No alert rules have fired for this agent yet. When URL or keystroke telemetry matches a
              rule, a row appears here and the dashboard can show a live notification.
            </Box>
          </SpaceBetween>
        </Box>
      }
    />
  );
}
