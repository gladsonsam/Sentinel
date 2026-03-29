import { useState, useEffect, FormEvent } from "react";
import { Folder, FileText, ArrowLeft, RefreshCw, Loader2, HardDrive } from "lucide-react";
import { useWebSocket } from "../hooks/useWebSocket";
import { WsEvent } from "../lib/types";

interface FilesTabProps {
  agentId: string;
}

export function FilesTab({ agentId }: FilesTabProps) {
  const [currentPath, setCurrentPath] = useState("C:\\");
  const [inputPath, setInputPath] = useState("C:\\");
  const [items, setItems] = useState<{name: string; is_dir: boolean; size: number}[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadChunks, setDownloadChunks] = useState<Record<string, string[]>>({});

  const { send } = useWebSocket({
    onMessage: (ev: WsEvent) => {
      if (ev.event === "dir_list" && ev.agent_id === agentId) {
        // Fix for multiple incoming packets matching just the agent
        if (ev.data.path.toLowerCase() === currentPath.toLowerCase()) {
          setItems(ev.data.items);
          setLoading(false);
        }
      }
      if (ev.event === "file_chunk" && ev.agent_id === agentId) {
        if (ev.data.is_error) {
          setDownloading(null);
          setDownloadChunks({});
          alert(`Error reading file: ${ev.data.data}`);
          return;
        }

        const path = ev.data.path;
        const index = ev.data.chunk_index;
        const total = ev.data.total_chunks;

        setDownloadChunks(prev => {
          const arr = prev[path] || new Array(total).fill("");
          arr[index] = ev.data.data;

          // Check if complete
          if (arr.filter(c => c !== "").length === total) {
            const fullBase64 = arr.join("");
            const link = document.createElement("a");
            link.href = `data:application/octet-stream;base64,${fullBase64}`;
            link.download = path.split('\\').pop() || path.split('/').pop() || "file";
            link.click();

            // Clean up
            setDownloading(null);
            const { [path]: _, ...rest } = prev;
            return rest;
          }

          return { ...prev, [path]: arr };
        });
      }
    },
    onStatusChange: () => {},
  });

  const loadDir = (path: string) => {
    setCurrentPath(path);
    setInputPath(path);
    setLoading(true);
    send({
      type: "control",
      agent_id: agentId,
      cmd: { type: "ListDir", path },
    });
  };

  useEffect(() => {
    loadDir("C:\\");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    loadDir(inputPath);
  };

  const getFullPath = (name: string) => {
    const sep = currentPath.endsWith("\\") || currentPath.endsWith("/") ? "" : "\\";
    return currentPath + sep + name;
  };

  const handleItemClick = (item: {name: string, is_dir: boolean}) => {
    if (item.is_dir) {
      loadDir(getFullPath(item.name));
    } else {
      const full = getFullPath(item.name);
      setDownloading(full);
      send({
        type: "control",
        agent_id: agentId,
        cmd: {
          type: "ReadFile",
          path: full,
        }
      });
    }
  };

  const goUp = () => {
    let normalized = currentPath.replace(/\//g, "\\");
    if (normalized.endsWith("\\")) {
      normalized = normalized.slice(0, -1);
    }
    const idx = normalized.lastIndexOf("\\");
    if (idx > 0) {
      const newPath = normalized.substring(0, idx + 1);
      loadDir(newPath);
    } else if (idx === -1 && normalized.length === 2 && normalized[1] === ':') {
      // It's a drive root like "C:" -> reload "C:\"
      loadDir(normalized + "\\");
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col h-full bg-bg">
      <div className="flex items-center gap-2 mb-4 bg-surface p-3 rounded-lg border border-border">
        <button
          onClick={goUp}
          className="p-1.5 hover:bg-border/40 rounded transition-colors text-muted hover:text-primary"
          title="Go up"
        >
          <ArrowLeft size={16} />
        </button>
        <button
          onClick={() => loadDir(currentPath)}
          className="p-1.5 hover:bg-border/40 rounded transition-colors text-muted hover:text-primary"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>

        <form onSubmit={handleFormSubmit} className="flex-1 flex items-center">
          <HardDrive size={14} className="text-muted mr-2" />
          <input
            type="text"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            className="flex-1 bg-transparent border border-border rounded px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </form>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-surface z-10 border-b border-border shadow-sm">
            <tr>
              <th className="px-4 py-3 font-medium text-muted w-10">Icon</th>
              <th className="px-4 py-3 font-medium text-muted">Name</th>
              <th className="px-4 py-3 font-medium text-muted">Size</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr 
                key={i} 
                onClick={() => handleItemClick(item)}
                className="border-b border-border/50 hover:bg-bg/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-2.5">
                  {item.is_dir ? (
                    <Folder size={16} className="text-accent" />
                  ) : (
                    <FileText size={16} className="text-muted" />
                  )}
                </td>
                <td className="px-4 py-2.5 font-medium truncate max-w-xs sm:max-w-md">
                  {item.name}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {item.is_dir ? "—" : formatSize(item.size)}
                  {!item.is_dir && downloading === getFullPath(item.name) && (
                    <span className="ml-2 inline-flex items-center text-accent text-xs">
                      <Loader2 size={12} className="animate-spin mr-1" />
                      Downloading... {downloadChunks[getFullPath(item.name)] ? Math.round((downloadChunks[getFullPath(item.name)].filter(c => c !== "").length / downloadChunks[getFullPath(item.name)].length) * 100) + "%" : ""}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-muted">
                  Folder is empty
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
