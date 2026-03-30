import { useCallback, useEffect, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Pagination from "@cloudscape-design/components/pagination";
import TextFilter from "@cloudscape-design/components/text-filter";
import { useCollection } from "@cloudscape-design/collection-hooks";
import { api } from "../../lib/api";
import type { AgentSoftwareRow } from "../../lib/types";
import { fmtDateTime, formatWindowsInstallDate, installDateSortKey } from "../../lib/utils";

type SoftwareRow = AgentSoftwareRow & {
  id: string;
  install_date_sort: string;
  /** Stable string for table sort (publisher may be null from API). */
  publisher_sort: string;
};

interface SoftwareTabProps {
  agentId: string;
}

export function SoftwareTab({ agentId }: SoftwareTabProps) {
  const [rows, setRows] = useState<SoftwareRow[]>([]);
  const [lastCaptured, setLastCaptured] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const data = await api.agentSoftware(agentId);
      setRows(
        (data.rows ?? []).map((r, idx) => ({
          ...r,
          id: `${idx}-${r.name}`,
          install_date_sort: installDateSortKey(r.install_date ?? null),
          publisher_sort: r.publisher ?? "",
        })),
      );
      setLastCaptured(data.last_captured_at ?? null);
    } catch (e) {
      setErr(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCollect = async () => {
    setCollecting(true);
    setErr(null);
    try {
      await api.collectAgentSoftware(agentId);
      await new Promise((r) => setTimeout(r, 2500));
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setCollecting(false);
    }
  };

  const { items, collectionProps, filterProps, paginationProps } = useCollection(rows, {
    filtering: {
      filteringFunction: (item, filteringText) => {
        const q = filteringText.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          (item.version ?? "").toLowerCase().includes(q) ||
          (item.publisher ?? "").toLowerCase().includes(q)
        );
      },
    },
    pagination: { pageSize: 50 },
    sorting: {
      defaultState: {
        sortingColumn: { sortingField: "name" },
        isDescending: false,
      },
    },
  });

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description="Installed programs from the agent’s Windows registry (Uninstall keys). Refreshed daily while online, or on demand below."
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => void load()} disabled={loading}>
              Refresh list
            </Button>
            <Button variant="primary" loading={collecting} onClick={() => void onCollect()}>
              Collect now
            </Button>
          </SpaceBetween>
        }
      >
        Installed software
      </Header>
      {lastCaptured && (
        <Box variant="p" color="text-body-secondary">
          Last inventory stored: {fmtDateTime(lastCaptured)}
        </Box>
      )}
      {err && (
        <Box variant="p" color="text-status-error">
          {err}
        </Box>
      )}
      <Table
        {...collectionProps}
        trackBy="id"
        columnDefinitions={[
          { id: "name", header: "Name", cell: (i) => i.name, sortingField: "name" },
          { id: "version", header: "Version", cell: (i) => i.version || "—" },
          {
            id: "publisher",
            header: "Publisher",
            cell: (i) => i.publisher || "—",
            sortingField: "publisher_sort",
          },
          {
            id: "install_date",
            header: "Install date",
            cell: (i) => formatWindowsInstallDate(i.install_date ?? null),
            sortingField: "install_date_sort",
          },
        ]}
        items={items}
        loading={loading}
        loadingText="Loading software inventory"
        filter={
          <TextFilter {...filterProps} filteringPlaceholder="Find software" countText={`${items.length} matches`} />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" color="text-body-secondary" padding="l">
            No inventory yet. The agent sends a list about a minute after connecting, then once per day, or use
            Collect now (agent must be online).
          </Box>
        }
      />
    </SpaceBetween>
  );
}
