//! Screen Capture Module – xcap (demand-driven)
//!
//! The capture loop only runs while the server has active MJPEG viewers.
//! When the server wants to start streaming it sends JSON such as
//! `{"type":"start_capture","jpeg_quality":40,"interval_ms":200}` (fields optional; defaults apply).
//! over the control WebSocket; when the last viewer disconnects it sends
//! `{"type":"stop_capture"}`.
//!
//! [`start_capture`] spawns the OS thread and returns an [`Arc<AtomicBool>`]
//! stop flag.  Setting that flag to `true` causes the thread to exit cleanly
//! after its current frame.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use image::{codecs::jpeg::JpegEncoder, ExtendedColorType, ImageEncoder};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;
use tracing::{error, info, warn};
use xcap::Monitor;

// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
pub struct CaptureSettings {
    pub jpeg_quality: u8,
    pub interval_ms: u64,
}

impl Default for CaptureSettings {
    fn default() -> Self {
        Self {
            jpeg_quality: 40,
            interval_ms: 200,
        }
    }
}

/// Spawn the capture loop on a dedicated OS thread; return its stop flag.
///
/// Frames are JPEG-encoded (quality configurable) and sent on `tx` on `settings.interval_ms`.
/// Setting `stop` to `true` causes the thread to exit after the current frame.
///
/// When `tx` is closed (channel dropped) the thread also exits automatically.
pub fn start_capture(
    tx: mpsc::Sender<Vec<u8>>,
    stop: Arc<AtomicBool>,
    settings: CaptureSettings,
) -> anyhow::Result<()> {
    let jpeg_quality = settings.jpeg_quality.max(1).min(100);
    let interval_ms = settings.interval_ms.max(1);
    std::thread::Builder::new()
        .name("screen-capture".into())
        .spawn(move || {
            let monitor = match Monitor::all()
                .ok()
                .and_then(|ms| ms.into_iter().find(|m| m.is_primary().unwrap_or(false)))
            {
                Some(m) => m,
                None => {
                    error!("Screen capture: no primary monitor found.");
                    return;
                }
            };

            info!(
                "Screen capture started: {}×{} (jpeg_q={jpeg_quality}, interval_ms={interval_ms})",
                monitor.width().unwrap_or(0),
                monitor.height().unwrap_or(0),
            );

            // Reuse one buffer per frame to avoid allocator churn on the capture thread.
            let mut jpeg_data: Vec<u8> = Vec::new();

            loop {
                // Check stop flag first so we exit promptly.
                if stop.load(Ordering::Relaxed) {
                    info!("Screen capture stopped on demand.");
                    break;
                }

                match monitor.capture_image() {
                    Ok(rgba_img) => {
                        let rgb = image::DynamicImage::ImageRgba8(rgba_img).into_rgb8();

                        jpeg_data.clear();
                        let encoder = JpegEncoder::new_with_quality(&mut jpeg_data, jpeg_quality);

                        match encoder.write_image(
                            rgb.as_raw(),
                            rgb.width(),
                            rgb.height(),
                            ExtendedColorType::Rgb8,
                        ) {
                            Err(e) => warn!("JPEG encode error (skipping): {e}"),
                            Ok(()) => match tx.try_send(std::mem::take(&mut jpeg_data)) {
                                Ok(()) => {}
                                Err(TrySendError::Full(v)) => {
                                    // Consumer busy – drop stale frame; keep capacity for next encode.
                                    jpeg_data = v;
                                }
                                Err(TrySendError::Closed(_)) => {
                                    info!("Frame channel closed; stopping capture.");
                                    break;
                                }
                            },
                        }
                    }
                    Err(e) => warn!("Screen capture error (skipping): {e}"),
                }

                std::thread::sleep(Duration::from_millis(interval_ms));
            }
        })
        .map_err(|e| anyhow::anyhow!("Failed to spawn capture thread: {e}"))?;

    Ok(())
}
