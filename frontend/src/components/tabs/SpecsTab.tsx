import { useState, useEffect } from "react";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import ColumnLayout from "@cloudscape-design/components/column-layout";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import { apiUrl } from "../../lib/api";
import type { AgentInfo } from "../../lib/types";

interface SpecsTabProps {
  agentId: string;
  cachedInfo?: AgentInfo | null;
}

export function SpecsTab({ agentId, cachedInfo }: SpecsTabProps) {
  const [info, setInfo] = useState<AgentInfo | null>(cachedInfo || null);
  const [loading, setLoading] = useState(!cachedInfo);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (cachedInfo) {
      setInfo(cachedInfo);
      setLoading(false);
      return;
    }

    const fetchInfo = async () => {
      try {
        setLoading(true);
        const response = await fetch(apiUrl(`/agents/${agentId}/info`), {
          credentials: "include",
        });
        
        if (response.ok) {
          const data = await response.json();
          setInfo(data?.info ?? data ?? null);
        } else {
          setError("Failed to load system information");
        }
      } catch (err) {
        setError("Error fetching system information");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [agentId, cachedInfo]);

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
        </Box>
      </Container>
    );
  }

  if (error || !info) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Box variant="p" color="text-status-error">
            {error || "No system information available"}
          </Box>
        </Box>
      </Container>
    );
  }

  const formatMemory = (bytes: number) => {
    const gb = (bytes / (1024 * 1024 * 1024)).toFixed(2);
    return `${gb} GB`;
  };

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">System Information</Header>}>
        <ColumnLayout columns={2} variant="text-grid">
          <KeyValuePairs
            columns={1}
            items={[
              { label: "Hostname", value: info.hostname || "—" },
              { label: "Operating System", value: info.os_name || "—" },
              { label: "OS Version", value: info.os_version || "—" },
              { label: "Kernel Version", value: info.kernel_version || "—" },
            ]}
          />
          <KeyValuePairs
            columns={1}
            items={[
              { label: "CPU", value: info.cpu_brand || "—" },
              { label: "CPU Cores", value: info.cpu_cores?.toString() || "—" },
              {
                label: "Memory",
                value: info.memory_total_mb
                  ? `${formatMemory(info.memory_used_mb || 0)} / ${formatMemory(info.memory_total_mb)}`
                  : "—",
              },
            ]}
          />
        </ColumnLayout>
      </Container>

      <Container header={<Header variant="h2">Network Adapters</Header>}>
        {info.adapters && info.adapters.length > 0 ? (
          <SpaceBetween size="l">
            {info.adapters.map((adapter, idx) => (
              <Box key={idx}>
                <Box variant="h3" margin={{ bottom: "s" }}>
                  {adapter.name || `Adapter ${idx + 1}`}
                </Box>
                <ColumnLayout columns={2} variant="text-grid">
                  <KeyValuePairs
                    columns={1}
                    items={[
                      {
                        label: "MAC Address",
                        value: adapter.mac || "—",
                      },
                      {
                        label: "IPv4 Addresses",
                        value:
                          adapter.ips && adapter.ips.length > 0
                            ? adapter.ips.join(", ")
                            : "—",
                      },
                      {
                        label: "IPv6 Addresses",
                        value: "—", // IPv6 not in current schema
                      },
                    ]}
                  />
                  <KeyValuePairs
                    columns={1}
                    items={[
                      {
                        label: "Gateway",
                        value:
                          adapter.gateways && adapter.gateways.length > 0
                            ? adapter.gateways.join(", ")
                            : "—",
                      },
                      {
                        label: "DNS Servers",
                        value:
                          adapter.dns && adapter.dns.length > 0
                            ? adapter.dns.join(", ")
                            : "—",
                      },
                    ]}
                  />
                </ColumnLayout>
              </Box>
            ))}
          </SpaceBetween>
        ) : (
          <Box textAlign="center" padding="l">
            <Box variant="p" color="text-body-secondary">
              No network adapters found
            </Box>
          </Box>
        )}
      </Container>
    </SpaceBetween>
  );
}
