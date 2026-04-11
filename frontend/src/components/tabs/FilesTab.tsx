import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
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
  const DRIVES_PATH = "__this_pc__";
  // Empty path means "agent default" (usually user's Documents).
  const [currentPath, setCurrentPath] = useState("");
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [, setChunksByPath] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadWaiterRef = useRef<{
    destPath: string;
    resolve: (outcome: { ok: boolean; error?: string }) => void;
  } | null>(null);

  const RAW_UPLOAD_CHUNK = 32 * 1024;

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  const loadDirectory = useCallback((path: string) => {
    setLoading(true);
    sendWsMessage({
      type: "control",
      agent_id: agentId,
      cmd: path ? { type: "ListDir", path } : { type: "ListDir" },
    });
  }, [agentId, sendWsMessage]);

  useEffect(() => {
    const onWsEvent = (event: Event) => {
      const customEvent = event as CustomEvent<any>;
      const data = customEvent.detail;
      if (!data || data.agent_id !== agentId) return;

      if (data.event === "dir_list") {
        const path = typeof data?.data?.path === "string" ? data.data.path : "";
        // When `currentPath` is empty we asked the agent to pick a sensible default
        // (usually Documents). Accept the first reply and lock onto that path.
        if (!currentPath) {
          if (path) setCurrentPath(path);
          setItems(data.data.items || []);
          setLoading(false);
          return;
        }
        if (path && path.toLowerCase() === currentPath.toLowerCase()) {
          setItems(data.data.items || []);
          setLoading(false);
        }
      }

      if (data.event === "file_upload_result") {
        if (data.agent_id !== agentId) return;
        const p = data.data?.path;
        const w = uploadWaiterRef.current;
        if (!w || !p) return;
        if (p.toLowerCase() === w.destPath.toLowerCase()) {
          w.resolve({
            ok: !!data.data.ok,
            error: typeof data.data.error === "string" ? data.data.error : undefined,
          });
          uploadWaiterRef.current = null;
        }
        return;
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
    setCurrentPath("");
    setItems([]);
    setLoading(false);
    setDownloading(null);
    setDownloadProgress(0);
    setChunksByPath({});
    setUploading(null);
    setUploadProgress(0);
    setUploadMessage(null);
    uploadWaiterRef.current = null;
  }, [agentId]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const handleFileClick = (item: FileItem) => {
    if (item.is_dir) {
      if (currentPath === DRIVES_PATH) {
        navigateTo(item.name);
        return;
      }
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
    if (!currentPath || currentPath === DRIVES_PATH) return [{ text: "Root", href: "#" }];

    const parts = currentPath.split("\\").filter((p) => p);
    const breadcrumbs = [{ text: "Root", href: "#" }];
    
    let accumulated = "";
    for (const part of parts) {
      accumulated += part + "\\";
      breadcrumbs.push({ text: part, href: "#" + accumulated });
    }
    
    return breadcrumbs;
  };

  const canUpload =
    Boolean(currentPath) &&
    currentPath !== DRIVES_PATH;

  const uint8ToBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    const step = 8192;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
  };

  const runUpload = async (file: File) => {
    if (!canUpload) return;
    const destPath = currentPath.endsWith("\\")
      ? currentPath + file.name
      : currentPath + "\\" + file.name;
    const totalChunks = Math.max(1, Math.ceil(file.size / RAW_UPLOAD_CHUNK));
    setUploadMessage(null);
    setUploading(destPath);
    setUploadProgress(0);

    const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      uploadWaiterRef.current = { destPath, resolve };
    });
    const timeoutMs = Math.min(600_000, 30_000 + totalChunks * 2000);
    const timeout = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      setTimeout(
        () => resolve({ ok: false, error: "Upload timed out waiting for the agent." }),
        timeoutMs,
      );
    });

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * RAW_UPLOAD_CHUNK;
        const end = Math.min(start + RAW_UPLOAD_CHUNK, file.size);
        const slice = file.slice(start, end);
        const buf = new Uint8Array(await slice.arrayBuffer());
        const b64 = uint8ToBase64(buf);
        sendWsMessage({
          type: "control",
          agent_id: agentId,
          cmd: {
            type: "WriteFileChunk",
            path: destPath,
            chunk_index: i,
            total_chunks: totalChunks,
            data: b64,
          },
        });
        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      const outcome = await Promise.race([done, timeout]);
      uploadWaiterRef.current = null;
      if (outcome.ok) {
        setUploadMessage("Upload finished.");
        loadDirectory(currentPath);
      } else {
        setUploadMessage(outcome.error?.trim() || "Upload failed.");
      }
    } catch {
      setUploadMessage("Upload failed.");
      uploadWaiterRef.current = null;
    } finally {
      setUploading(null);
      setUploadProgress(0);
    }
  };

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void runUpload(f);
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
            // "Root" means "This PC" (drive list), not the agent's default folder.
            navigateTo(DRIVES_PATH);
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

      {uploading && (
        <ProgressBar
          value={uploadProgress}
          label="Uploading file"
          description={uploading}
        />
      )}

      {uploadMessage && (
        <Box color={uploadMessage.includes("failed") || uploadMessage.includes("timed out") || uploadMessage.includes("rejected") ? "text-status-error" : "text-status-success"}>
          {uploadMessage}
        </Box>
      )}

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={onFileInputChange}
      />

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
                  disabled={downloading !== null || uploading !== null}
                />
              ),
            width: 100,
          },
        ]}
        items={items}
        variant="container"
        stickyHeader
        header={
          <Header
            actions={
              <Button
                disabled={!canUpload || loading || downloading !== null || uploading !== null}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload
              </Button>
            }
          >
            File Browser
          </Header>
        }
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
