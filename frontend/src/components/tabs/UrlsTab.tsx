import { useCallback, useEffect, useMemo, useState } from "react";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import Pagination from "@cloudscape-design/components/pagination";
import TextFilter from "@cloudscape-design/components/text-filter";
import Button from "@cloudscape-design/components/button";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import Link from "@cloudscape-design/components/link";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { api, apiUrl } from "../../lib/api";
import { fmtDateTime } from "../../lib/utils";

interface URLEvent {
  id: number;
  url: string;
  browser: string;
  timestamp: string;
  category_key?: string | null;
  category?: string | null;
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
  const [categoryStats, setCategoryStats] = useState<{ category: string; visit_count: number; last_ts: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfillLoading, setBackfillLoading] = useState(false);

  const fetchUrls = useCallback(async () => {
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
            category_key: (row.category_key ?? null) as string | null,
            category: (row.category ?? null) as string | null,
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

      const catRes = await fetch(apiUrl(`/agents/${agentId}/url-category-stats?limit=12`), {
        credentials: "include",
      });
      if (catRes.ok) {
        const catData = await catRes.json();
        const catRows = Array.isArray(catData?.rows) ? catData.rows : [];
        setCategoryStats(
          catRows.map((row: Record<string, unknown>) => ({
            category: String(row.category ?? ""),
            visit_count: Number(row.visit_count ?? 0),
            last_ts: String(row.last_ts ?? ""),
          }))
        );
      } else {
        setCategoryStats([]);
      }
    } catch (err) {
      console.error("Failed to fetch URLs:", err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchUrls();
  }, [fetchUrls]);

  useEffect(() => {
    const onChanged = () => void fetchUrls();
    window.addEventListener("sentinel.urlCategoriesChanged", onChanged as EventListener);
    return () => window.removeEventListener("sentinel.urlCategoriesChanged", onChanged as EventListener);
  }, [fetchUrls]);

  const backfill = async () => {
    setBackfillLoading(true);
    try {
      await api.agentUrlCategoryBackfill(agentId, { limit: 25_000 });
      // Give the worker a moment, then refresh.
      window.setTimeout(() => { void fetchUrls(); }, 1200);
    } catch (e) {
      console.error("Backfill failed:", e);
    } finally {
      setBackfillLoading(false);
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
            (item.browser || "").toLowerCase().includes(searchText) ||
            (item.category || "").toLowerCase().includes(searchText)
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
    const cats = categoryStats
      .filter((r) => (r.category || "").trim() !== "" && Number.isFinite(r.visit_count) && r.visit_count > 0)
      .slice(0, 6)
      .map((r) => `${r.category} (${r.visit_count})`);
    if (cats.length > 0 && hosts.length > 0) {
      return `Top categories: ${cats.join(" • ")}. Top hostnames retained long-term: ${hosts.join(" • ")}`;
    }
    if (cats.length > 0) {
      return `Top categories: ${cats.join(" • ")}`;
    }
    return hosts.length > 0
      ? `Top hostnames retained long-term: ${hosts.join(" • ")}`
      : "Top URL aggregates are retained after raw URL retention expiry.";
  }, [topItems, categoryStats]);

  const hasUncategorized = useMemo(
    () => items.some((r) => (r.category ?? "").trim() === ""),
    [items]
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
          id: "category",
          header: "Category",
          cell: (item) => item.category || "—",
          sortingField: "category",
          width: 160,
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
            <>
              <ButtonDropdown
                items={[
                  {
                    id: "backfill",
                    text: "Categorize existing URL history",
                    disabled: !hasUncategorized || backfillLoading,
                    disabledReason: !hasUncategorized ? "No uncategorized URL rows in this view." : undefined,
                  },
                ]}
                onItemClick={({ detail }) => {
                  if (detail.id === "backfill") void backfill();
                }}
                loading={backfillLoading}
              >
                Maintenance
              </ButtonDropdown>
              <Button iconName="refresh" onClick={fetchUrls}>
                Refresh
              </Button>
            </>
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
