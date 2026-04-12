import { useState, useEffect, useMemo } from "react";
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

function normalizeHref(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "#";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function hostnameFromUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(href).hostname;
  } catch {
    return raw.split(/[/:?#]/)[0] || raw;
  }
}

/** Distinct hostnames in server top-URL order, up to `max` entries. */
function topHostnamesFromRows(rows: TopUrlRow[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const host = hostnameFromUrl(row.url);
    const key = host.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(host);
    if (out.length >= max) break;
  }
  return out;
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
          rows.map((row: Record<string, unknown>) => ({
            id: Number(row.id ?? 0),
            url: String(row.url ?? ""),
            browser: String(row.browser ?? "—"),
            timestamp: String(row.timestamp ?? row.ts ?? ""),
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
          topRows.map((row: Record<string, unknown>) => ({
            url: String(row.url ?? ""),
            visit_count: Number(row.visit_count ?? 0),
            last_ts: String(row.last_ts ?? ""),
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

  const headerDescription = useMemo(() => {
    const hosts = topHostnamesFromRows(topItems, 6);
    return hosts.length > 0
      ? `Top hostnames retained long-term: ${hosts.join(" • ")}`
      : "Top URL aggregates are retained after raw URL retention expiry.";
  }, [topItems]);

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
          description={headerDescription}
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
