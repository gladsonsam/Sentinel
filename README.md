# Sentinel

A lightweight, self-hosted monitoring system built with Rust and React. A Windows agent streams real-time telemetry to the server, which feeds a live web dashboard with screen streaming, window/URL tracking, and activity history.

## Screenshots

![Agents overview](docs/images/dashboard-agents-overview.jpg)

![Agent screen viewer](docs/images/agent-screen-viewer.jpg)

![Agent activity timeline](docs/images/agent-activity-timeline.jpg)

Tab-by-tab UI tour (with more detail): **[wiki → Features](https://github.com/gladsonsam/Sentinel/wiki/Features)**.

> [!WARNING]
> This project was **largely written with AI assistance** and is intended for **experimentation and testing**, not as a hardened or supported product. **Do not rely on it in production** or for sensitive environments. Monitoring, remote control, and keystroke-related features carry inherent privacy and security implications; the codebase has **not** undergone professional security review and may contain bugs, weak defaults, or other issues that could expose data or systems. Use at your own risk.

## Features

- **Activity timeline** — A browsable history of foreground apps/windows with durations.
- **Live screen viewer** — Demand-driven MJPEG screen streaming
- **Remote control** — Send mouse and keyboard commands from the dashboard to the agent.
- **Telemetry capture** — Window focus, URLs, AFK/active transitions and keystroke capture.

## Tech stack


| Component              | Technology                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| **sentinel-agent**     | Rust (Windows, hidden Tauri settings window + hotkey, xcap, enigo) |
| **sentinel-server**    | Rust (Axum, Tokio, SQLx, PostgreSQL)                               |
| **sentinel-dashboard** | React 19, Vite, TailwindCSS                                        |


## Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d
```


## Documentation

**Deploy, configure, use the dashboard and agent, and develop:** see the **[GitHub wiki](https://github.com/gladsonsam/Sentinel/wiki)**.

## License

MIT — see [LICENSE](LICENSE).
