import { useState, useEffect, useCallback } from "react";
import Table from "@cloudscape-design/components/table";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Button from "@cloudscape-design/components/button";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import Icon from "@cloudscape-design/components/icon";
import SpaceBetween from "@cloudscape-design/components/space-between";

interface FileItem {
  name: string;
  is_dir: boolean;
  size: number;
}

interface FilesTabProps {
  agentId: string;
  sendWsMessage: (msg: any) => void;
}

export function FilesTab({ agentId, sendWsMessage }: FilesTabProps) {
  const [currentPath, setCurrentPath] = useState("C:\\");
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [, setChunksByPath] = useState<Record<string, string[]>>({});

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  const loadDirectory = useCallback((path: string) => {
    setLoading(true);
    sendWsMessage({
      type: "control",
      agent_id: agentId,
      cmd: { type: "ListDir", path },
    });
  }, [agentId, sendWsMessage]);

  useEffect(() => {
    const onWsEvent = (event: Event) => {
      const customEvent = event as CustomEvent<any>;
      const data = customEvent.detail;
      if (!data || data.agent_id !== agentId) return;

      if (data.event === "dir_list") {
        if (typeof data?.data?.path === "string" && data.data.path.toLowerCase() === currentPath.toLowerCase()) {
          setItems(data.data.items || []);
          setLoading(false);
        }
      }

      if (data.event === "file_chunk") {
        if (data.data.is_error) {
          setDownloading(null);
          setChunksByPath({});
          setDownloadProgress(0);
          return;
        }
        const path = data.data.path;
        const index = data.data.chunk_index;
        const total = data.data.total_chunks;

        setChunksByPath((prev) => {
          const chunks = prev[path] ? [...prev[path]] : new Array(total).fill("");
          chunks[index] = data.data.data;
          const received = chunks.filter((chunk) => chunk !== "").length;
          setDownloadProgress(Math.round((received / total) * 100));

          if (received === total) {
            const fullBase64 = chunks.join("");
            const link = document.createElement("a");
            link.href = `data:application/octet-stream;base64,${fullBase64}`;
            link.download = path.split("\\").pop() || "file";
            link.click();
            setDownloading(null);
            setDownloadProgress(0);
            const clone = { ...prev };
            delete clone[path];
            return clone;
          }

          return { ...prev, [path]: chunks };
        });
      }
    };

    window.addEventListener("sentinel-ws-event", onWsEvent as EventListener);
    return () => window.removeEventListener("sentinel-ws-event", onWsEvent as EventListener);
  }, [agentId, currentPath]);

  useEffect(() => {
    setCurrentPath("C:\\");
    setItems([]);
    setLoading(false);
    setDownloading(null);
    setDownloadProgress(0);
    setChunksByPath({});
  }, [agentId]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const handleFileClick = (item: FileItem) => {
    if (item.is_dir) {
      const newPath = currentPath.endsWith("\\")
        ? currentPath + item.name
        : currentPath + "\\" + item.name;
      navigateTo(newPath);
    }
  };

  const handleDownload = (item: FileItem) => {
    const filePath = currentPath.endsWith("\\")
      ? currentPath + item.name
      : currentPath + "\\" + item.name;
    
    setDownloading(filePath);
    setDownloadProgress(0);
    
    sendWsMessage({
      type: "control",
      agent_id: agentId,
      cmd: { type: "ReadFile", path: filePath },
    });
  };

  const getBreadcrumbs = () => {
    const parts = currentPath.split("\\").filter((p) => p);
    const breadcrumbs = [{ text: "Root", href: "#" }];
    
    let accumulated = "";
    for (const part of parts) {
      accumulated += part + "\\";
      breadcrumbs.push({ text: part, href: "#" + accumulated });
    }
    
    return breadcrumbs;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <SpaceBetween size="l">
      <BreadcrumbGroup
        items={getBreadcrumbs()}
        onFollow={(e) => {
          e.preventDefault();
          const href = e.detail.href;
          if (href === "#") {
            navigateTo("C:\\");
          } else {
            navigateTo(href.substring(1));
          }
        }}
      />

      {downloading && (
        <ProgressBar
          value={downloadProgress}
          label="Downloading file"
          description={downloading}
        />
      )}

      <Table
        loading={loading}
        loadingText="Loading directory..."
        columnDefinitions={[
          {
            id: "icon",
            header: "",
            cell: (item) => (
              <Icon
                name={item.is_dir ? "folder" : "file"}
                size="medium"
              />
            ),
            width: 50,
          },
          {
            id: "name",
            header: "Name",
            cell: (item) => (
              <span
                style={{ cursor: item.is_dir ? "pointer" : "default" }}
                onClick={() => item.is_dir && handleFileClick(item)}
              >
                {item.name}
              </span>
            ),
            sortingField: "name",
          },
          {
            id: "size",
            header: "Size",
            cell: (item) => (item.is_dir ? "—" : formatFileSize(item.size)),
            width: 120,
          },
          {
            id: "actions",
            header: "Actions",
            cell: (item) =>
              !item.is_dir && (
                <Button
                  iconName="download"
                  variant="inline-icon"
                  onClick={() => handleDownload(item)}
                  disabled={downloading !== null}
                />
              ),
            width: 100,
          },
        ]}
        items={items}
        variant="container"
        stickyHeader
        header={<Header>File Browser</Header>}
        empty={
          <Box textAlign="center" color="inherit">
            <Box variant="p" color="inherit">
              Directory is empty
            </Box>
          </Box>
        }
      />
    </SpaceBetween>
  );
}
