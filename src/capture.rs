//! # Screen Capture Module
//!
//! Implements [`GraphicsCaptureApiHandler`] to hook into the **Windows
//! Graphics Capture API**.  Each raw frame is:
//!
//! 1. Read from the GPU as an RGBA8 pixel buffer (stride-padding stripped).
//! 2. Converted to RGB8 (JPEG does not support an alpha channel).
//! 3. JPEG-encoded at **40 % quality** for low-bandwidth transmission.
//! 4. Pushed into a bounded [`tokio::sync::mpsc`] channel so the async
//!    WebSocket layer can drain and forward it.
//!
//! The capture loop runs on a dedicated **OS thread** (not a Tokio worker)
//! because `windows-capture` drives its own internal COM / WinRT event loop.

use anyhow::Result;
use image::{codecs::jpeg::JpegEncoder, ExtendedColorType, ImageBuffer, ImageEncoder, Rgba};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;
use tracing::{error, info, warn};
use windows_capture::{
    capture::GraphicsCaptureApiHandler,
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{ColorFormat, CursorCaptureSettings, DrawBorderSettings, Settings},
};

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

/// Errors that can occur inside the capture handler.
///
/// Both variants must be `Send + Sync + 'static` to satisfy the
/// `GraphicsCaptureApiHandler::Error` bound.
#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("Windows Graphics Capture error: {0}")]
    Windows(String),

    #[error("JPEG encoding error: {0}")]
    Image(#[from] image::ImageError),
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler implementation
// ─────────────────────────────────────────────────────────────────────────────

/// Capture handler that receives raw frames and forwards encoded JPEGs.
pub struct ScreenCaptureHandler {
    /// Async sender; shared with the Tokio event-loop via `Arc<Mutex<…>>` is
    /// NOT needed here – `mpsc::Sender` is already `Clone + Send`.
    tx: mpsc::Sender<Vec<u8>>,
}

impl GraphicsCaptureApiHandler for ScreenCaptureHandler {
    /// The sender is passed as the `Flags` payload when `start` is called.
    type Flags = mpsc::Sender<Vec<u8>>;
    type Error = CaptureError;

    fn new(tx: Self::Flags) -> Result<Self, Self::Error> {
        Ok(Self { tx })
    }

    /// Called by the runtime for every captured frame.
    ///
    /// - On encode failure the frame is **skipped** (logged at WARN) so
    ///   transient GPU glitches never abort the session.
    /// - If the channel is **full** the frame is **dropped** – this is
    ///   intentional back-pressure relief; the sender must never stall.
    /// - If the channel is **closed** (receiver dropped) capture is stopped
    ///   cleanly via [`InternalCaptureControl::stop`].
    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame<'_>,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        match self.encode_frame(frame) {
            Err(e) => {
                warn!("Frame encode error (frame skipped): {e}");
            }
            Ok(jpeg_bytes) => match self.tx.try_send(jpeg_bytes) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => {
                    // Downstream is busy – silently drop. The next frame will
                    // arrive within milliseconds.
                }
                Err(TrySendError::Closed(_)) => {
                    info!("Frame channel closed; stopping capture thread.");
                    capture_control.stop();
                }
            },
        }
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        info!("Windows Graphics Capture session closed.");
        Ok(())
    }
}

impl ScreenCaptureHandler {
    /// Encode a single frame as JPEG at 40 % quality.
    ///
    /// Steps:
    /// 1. Obtain the frame pixel buffer (removes row-stride padding).
    /// 2. Wrap as `ImageBuffer<Rgba<u8>>`.
    /// 3. Convert to `ImageBuffer<Rgb<u8>>` (strips alpha for JPEG).
    /// 4. JPEG-encode with [`JpegEncoder`] at quality = 40.
    fn encode_frame(&self, frame: &mut Frame<'_>) -> Result<Vec<u8>, CaptureError> {
        // ── 1. Raw pixel data ─────────────────────────────────────────────
        let buffer = frame
            .buffer()
            .map_err(|e| CaptureError::Windows(e.to_string()))?;

        let width = buffer.width();
        let height = buffer.height();

        // `as_raw_nopadding_buffer` removes per-row padding that the API adds
        // for GPU alignment, returning a tightly-packed RGBA8 byte vector.
        let raw: Vec<u8> = buffer
            .as_raw_nopadding_buffer()
            .map_err(|e| CaptureError::Windows(e.to_string()))?;

        // ── 2. Build RGBA image buffer ────────────────────────────────────
        let rgba: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(width, height, raw).ok_or_else(|| {
                CaptureError::Windows(format!(
                    "Buffer/dimension mismatch ({}×{} px)",
                    width, height
                ))
            })?;

        // ── 3. Strip alpha → RGB ──────────────────────────────────────────
        let rgb = image::DynamicImage::ImageRgba8(rgba).into_rgb8();

        // ── 4. JPEG encode at 40 % quality ────────────────────────────────
        //
        // `JpegEncoder::write_image` via the `ImageEncoder` trait accepts raw
        // bytes + metadata, avoiding an extra copy compared to `encode_image`.
        let mut jpeg_data: Vec<u8> = Vec::new();
        let encoder = JpegEncoder::new_with_quality(&mut jpeg_data, 40);
        encoder.write_image(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            ExtendedColorType::Rgb8,
        )?;

        Ok(jpeg_data)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

/// Spawn the Windows Graphics Capture loop on a dedicated OS thread and
/// return immediately.
///
/// Encoded JPEG frames are pushed onto `tx`.  Drop the paired [`Receiver`]
/// to signal the capture thread to stop.
///
/// # Errors
/// Returns an error if the primary monitor cannot be enumerated or if the
/// capture thread fails to spawn.
pub fn start_capture(tx: mpsc::Sender<Vec<u8>>) -> Result<()> {
    let monitor = Monitor::primary()
        .map_err(|e| anyhow::anyhow!("Failed to obtain primary monitor: {e}"))?;

    let settings = Settings::new(
        monitor,
        // Capture the hardware cursor so the remote viewer sees pointer
        // position in real time.
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::Default,
        // RGBA8: 4 bytes per pixel; alpha is stripped before JPEG encoding.
        ColorFormat::Rgba8,
        tx, // ← forwarded as `Flags` to `ScreenCaptureHandler::new`
    );

    std::thread::Builder::new()
        .name("screen-capture".into())
        .spawn(move || {
            // This call blocks until `capture_control.stop()` is invoked or
            // an unrecoverable error occurs.
            if let Err(e) = ScreenCaptureHandler::start(settings) {
                error!("Screen capture fatal error: {e}");
            }
        })
        .map_err(|e| anyhow::anyhow!("Failed to spawn capture thread: {e}"))?;

    Ok(())
}
