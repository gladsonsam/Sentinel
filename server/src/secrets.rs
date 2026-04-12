//! Constant-time helpers for comparing secrets (avoids length leaks on raw byte equality).

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// Compare two secret strings in a way that does not leak the expected value via timing
/// on the comparison step. Values are compared via SHA-256 digests (fixed width).
#[must_use]
pub fn ct_compare_secret(provided: &str, expected: &str) -> bool {
    let a = Sha256::digest(provided.as_bytes());
    let b = Sha256::digest(expected.as_bytes());
    ConstantTimeEq::ct_eq(a.as_slice(), b.as_slice()).into()
}
