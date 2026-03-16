//! Screen Capture Module – Windows Graphics Capture API
//!
//! Implements [`GraphicsCaptureApiHandler`] to receive raw frames, encodes
//! them as JPEG at 40 % quality, and forwards them through a bounded
//! [`tokio::sync::mpsc`] channel to the async network layer.

use anyhow::Result;
use image::{codecs::jpeg::JpegEncoder, ExtendedColorType, ImageBuffer, ImageEncoder, Rgba};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;
use tracing::{error, info, warn};
use windows_capture::{
    capture::{Context, GraphicsCaptureApiHandler},
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("Windows Graphics Capture error: {0}")]
    Windows(String),

    #[error("JPEG encoding error: {0}")]
    Image(#[from] image::ImageError),
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

pub struct ScreenCaptureHandler {
    tx: mpsc::Sender<Vec<u8>>,
}

impl GraphicsCaptureApiHandler for ScreenCaptureHandler {
    type Flags = mpsc::Sender<Vec<u8>>;
    type Error = CaptureError;

    // In windows-capture 1.5+ the runtime wraps Flags inside a Context<Flags>
    // that also carries the D3D device handles. Access our sender via ctx.flags.
    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { tx: ctx.flags })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame<'_>,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        match self.encode_frame(frame) {
            Err(e) => {
                warn!("Frame encode error (skipping): {e}");
            }
            Ok(jpeg) => match self.tx.try_send(jpeg) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => {
                    // Consumer busy – drop this frame, next one arrives shortly.
                }
                Err(TrySendError::Closed(_)) => {
                    info!("Frame channel closed; stopping capture.");
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
    /// Encode a captured frame as JPEG at 40 % quality.
    fn encode_frame(&self, frame: &mut Frame<'_>) -> Result<Vec<u8>, CaptureError> {
        // `buffer()` mutably borrows `frame`; keep it in a separate binding so
        // that `as_nopadding_buffer` can take `&mut self` on the FrameBuffer.
        let mut buffer = frame
            .buffer()
            .map_err(|e| CaptureError::Windows(e.to_string()))?;

        let width  = buffer.width();
        let height = buffer.height();

        // Strip per-row GPU alignment padding → tightly packed RGBA8 bytes.
        let raw: Vec<u8> = buffer
            .as_nopadding_buffer()
            .map_err(|e| CaptureError::Windows(e.to_string()))?
            .to_vec();

        // Build RGBA image then convert to RGB (JPEG has no alpha channel).
        let rgba: ImageBuffer<Rgba<u8>, Vec<u8>> =
            ImageBuffer::from_raw(width, height, raw).ok_or_else(|| {
                CaptureError::Windows(format!("Buffer/dimension mismatch ({}×{})", width, height))
            })?;

        let rgb = image::DynamicImage::ImageRgba8(rgba).into_rgb8();

        // Encode with quality = 40.
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

/// Spawn the capture loop on a dedicated OS thread; return immediately.
pub fn start_capture(tx: mpsc::Sender<Vec<u8>>) -> Result<()> {
    let monitor = Monitor::primary()
        .map_err(|e| anyhow::anyhow!("Failed to get primary monitor: {e}"))?;

    let settings = Settings::new(
        monitor,
        CursorCaptureSettings::WithCursor,
        DrawBorderSettings::Default,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        tx,
    );

    std::thread::Builder::new()
        .name("screen-capture".into())
        .spawn(move || {
            if let Err(e) = ScreenCaptureHandler::start(settings) {
                error!("Screen capture fatal error: {e}");
            }
        })
        .map_err(|e| anyhow::anyhow!("Failed to spawn capture thread: {e}"))?;

    Ok(())
}
