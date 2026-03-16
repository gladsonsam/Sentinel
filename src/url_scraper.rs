//! # Browser URL Scraper
//!
//! Thin wrapper around the [`browser_url`] crate.  Reads the URL that is
//! currently shown in the active Chrome or Edge tab on Windows.
//!
//! The function is designed to be called on a 2-second [`tokio::time::interval`]
//! inside the async event loop.  Because the underlying crate uses the Windows
//! UI Automation API (a quick synchronous call), blocking the Tokio thread for
//! such a short duration is acceptable.  If you notice latency spikes, wrap
//! the call in [`tokio::task::spawn_blocking`] instead.
//!
//! ## API note
//! `browser_url::get_active_url()` is expected to return
//! `Result<Option<String>, impl std::error::Error>`.  Adjust the match arms
//! below if the installed version uses a different signature.

use tracing::warn;

/// Return the URL visible in the active Chrome / Edge tab, or `None`.
///
/// All errors from the underlying crate are demoted to a WARN log entry and
/// converted to `None` so the main event loop is never interrupted by a
/// transient browser-query failure.
pub fn get_active_url() -> Option<String> {
    // `browser_url::get_active_url()` →  Result<Option<String>, E>
    //
    // Some crate versions return `Result<String, E>` (no inner Option).
    // In that case replace the Ok arm with:
    //   Ok(url) => Some(url),
    match browser_url::get_active_url() {
        Ok(Some(url)) => {
            // Ignore empty strings that some browser states produce.
            if url.trim().is_empty() {
                None
            } else {
                Some(url)
            }
        }
        Ok(None) => None,
        Err(e) => {
            warn!("browser-url scrape error: {e}");
            None
        }
    }
}
