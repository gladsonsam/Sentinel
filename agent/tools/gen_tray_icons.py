from __future__ import annotations

from pathlib import Path


def overlay_dot(img, rgba: tuple[int, int, int, int]) -> None:
    """
    Draw a small bottom-right status dot with a subtle dark ring for contrast.
    Mutates the image in-place.
    """
    from PIL import ImageDraw

    w, h = img.size
    r = max(2, min(w, h) // 6)  # ~5px at 32x32
    margin = 2
    cx = w - r - margin
    cy = h - r - margin

    draw = ImageDraw.Draw(img)
    ring = (0, 0, 0, 140)
    # Ring (slightly larger), then inner fill.
    draw.ellipse((cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1), fill=ring)
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rgba)


def main() -> None:
    # Repo-relative paths
    here = Path(__file__).resolve()
    agent_dir = here.parents[1]
    icons_dir = agent_dir / "icons"

    src_ico = icons_dir / "icon.ico"
    if not src_ico.exists():
        raise SystemExit(f"Missing source icon: {src_ico}")

    out_ok = icons_dir / "tray_ok.png"
    out_bad = icons_dir / "tray_bad.png"
    out_busy = icons_dir / "tray_busy.png"

    from PIL import Image

    # Load ICO and pick the largest embedded image, then resize down cleanly.
    base = Image.open(src_ico)
    try:
        base = base.copy()
    except Exception:
        pass
    base = base.convert("RGBA").resize((32, 32), Image.Resampling.LANCZOS)

    ok = base.copy()
    overlay_dot(ok, (40, 196, 72, 255))  # green
    ok.save(out_ok, format="PNG", optimize=True)

    bad = base.copy()
    overlay_dot(bad, (220, 53, 69, 255))  # red
    bad.save(out_bad, format="PNG", optimize=True)

    busy = base.copy()
    overlay_dot(busy, (255, 193, 7, 255))  # yellow
    busy.save(out_busy, format="PNG", optimize=True)

    print("Wrote:")
    print(f"- {out_ok}")
    print(f"- {out_bad}")
    print(f"- {out_busy}")


if __name__ == "__main__":
    main()

