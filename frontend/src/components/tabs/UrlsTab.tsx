import { useState, useEffect } from "react";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import TextFilter from "@cloudscape-design/components/text-filter";
import Button from "@cloudscape-design/components/button";
import Link from "@cloudscape-design/components/link";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { apiUrl } from "../../lib/api";
import { fmtDateTime } from "../../lib/utils";

interface URLEvent {
  id: number;
  url: string;
  browser: string;
  timestamp: string;
}

interface TopUrlRow {
  url: string;
  visit_count: number;
  last_ts: string;
}

interface UrlsTabProps {
  agentId: string;
}

export function UrlsTab({ agentId }: UrlsTabProps) {
  const [items, setItems] = useState<URLEvent[]>([]);
  const [topItems, setTopItems] = useState<TopUrlRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUrls();
  }, [agentId]);

  const fetchUrls = async () => {
    try {
      setLoading(true);
      const response = await fetch(apiUrl(`/agents/${agentId}/urls?limit=500`), {
        credentials: "include",
      });
      
      if (response.ok) {
        const data = await response.json();
        const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
        setItems(
          rows.map((row: any) => ({
            id: row.id ?? 0,
            url: row.url ?? "",
            browser: row.browser ?? "—",
            timestamp: row.timestamp ?? row.ts ?? "",
          }))
        );
      }

      const topRes = await fetch(apiUrl(`/agents/${agentId}/top-urls?limit=20`), {
        credentials: "include",
      });
      if (topRes.ok) {
        const topData = await topRes.json();
        const topRows = Array.isArray(topData?.rows) ? topData.rows : [];
        setTopItems(
          topRows.map((row: any) => ({
            url: row.url ?? "",
            visit_count: row.visit_count ?? 0,
            last_ts: row.last_ts ?? "",
          }))
        );
      }
    } catch (err) {
      console.error("Failed to fetch URLs:", err);
    } finally {
      setLoading(false);
    }
  };

  const { items: displayItems, collectionProps, filterProps, paginationProps } = useCollection(
    items,
    {
      filtering: {
        empty: "No URLs found",
        noMatch: "No URLs match the filter",
        filteringFunction: (item, filteringText) => {
          const searchText = filteringText.toLowerCase();
          return (
            (item.url || "").toLowerCase().includes(searchText) ||
            (item.browser || "").toLowerCase().includes(searchText)
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
      loadingText="Loading URLs..."
      columnDefinitions={[
        {
          id: "timestamp",
          header: "Time",
          cell: (item) => fmtDateTime(item.timestamp),
          sortingField: "timestamp",
          width: 180,
        },
        {
          id: "browser",
          header: "Browser",
          cell: (item) => item.browser || "—",
          sortingField: "browser",
          width: 150,
        },
        {
          id: "url",
          header: "URL",
          cell: (item) => (
            <Link href={normalizeHref(item.url)} external fontSize="body-s">
              {item.url || "—"}
            </Link>
          ),
          sortingField: "url",
        },
      ]}
      items={displayItems}
      variant="container"
      stickyHeader
      header={
        <Header
          counter={`(${items.length})`}
          actions={
            <Button iconName="refresh" onClick={fetchUrls}>
              Refresh
            </Button>
          }
          description={
            topItems.length > 0
              ? `Top URLs retained long-term: ${topItems.slice(0, 3).map((t) => t.url).join(" • ")}`
              : "Top URL aggregates are retained after raw URL retention expiry."
          }
        >
          URL History
        </Header>
      }
      filter={
        <TextFilter
          {...filterProps}
          filteringPlaceholder="Search by URL or browser"
        />
      }
      pagination={<Pagination {...paginationProps} />}
      empty={
        <Box textAlign="center" color="inherit">
          <Box variant="p" color="inherit">
            No URL visits recorded
          </Box>
        </Box>
      }
    />
  );
}
  const normalizeHref = (value: string | undefined): string => {
    const raw = (value || "").trim();
    if (!raw) return "#";
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
  };
