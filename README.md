# Sentinel

A lightweight, self-hosted monitoring system built with Rust and React. A Windows agent streams real-time telemetry to the server, which feeds a live web dashboard with screen streaming, keylogging, window/URL tracking, and AFK detection.

> [!WARNING]
> This project was **largely written with AI assistance** and is intended for **experimentation and testing**, not as a hardened or supported product. **Do not rely on it in production** or for sensitive environments. Monitoring, remote control, and keystroke-related features carry inherent privacy and security implications; the codebase has **not** undergone professional security review and may contain bugs, weak defaults, or other issues that could expose data or systems. Use at your own risk.

## Features

- **Real-time dashboard** — Live WebSocket feed of window focus, keystrokes, URLs, and activity state.
- **MJPEG screen streaming** — Demand-driven screen capture; the agent stops capturing when no viewers are watching.
- **Remote control** — Send mouse and keyboard commands from the dashboard to the agent.
- **Agent and UI auth** — Shared secret for agents; password-protected dashboard sessions.
- **PostgreSQL persistence** — Historical record of keys, windows, URLs, and activity.
- **Single-container deploy** — The Rust server embeds the compiled React frontend; no separate web server needed.

## Tech stack

| Component | Technology |
|-----------|------------|
| **sentinel-agent** | Rust (Windows, hidden Tauri settings window + hotkey, xcap, enigo) |
| **sentinel-server** | Rust (Axum, Tokio, SQLx, PostgreSQL) |
| **sentinel-dashboard** | React 18, Vite, TailwindCSS |

## Documentation

**Deploy, configure, use the dashboard and agent, and develop:** see the **[GitHub wiki](https://github.com/gladsonsam/Sentinel/wiki)**.

## Health check

```bash
curl http://127.0.0.1:9000/healthz
```

Expect `200 OK`.

## License

MIT — see [LICENSE](LICENSE).
