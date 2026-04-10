from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]):
    from PIL import Image

    w, h = size
    img = Image.new("RGB", size, top)
    px = img.load()
    for y in range(h):
        t = y / max(1, (h - 1))
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def _local_tag(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _parse_viewbox(s: str | None) -> tuple[float, float, float, float]:
    if not s:
        return (0.0, 0.0, 32.0, 32.0)
    parts = re.split(r"[\s,]+", s.strip())
    if len(parts) != 4:
        return (0.0, 0.0, 32.0, 32.0)
    return tuple(float(x) for x in parts)  # type: ignore[return-value]


def _hex_to_rgba(color: str | None, default: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    if not color or not color.startswith("#") or len(color) not in (4, 7):
        return default
    h = color[1:]
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r, g, b, 255)


def parse_frontend_favicon(svg_path: Path) -> dict:
    """Read path + circle (+ colors) from frontend/public/favicon.svg."""
    tree = ET.parse(svg_path)
    root = tree.getroot()
    vb = _parse_viewbox(root.get("viewBox"))

    path_d: str | None = None
    stroke_rgba = (95, 107, 122, 255)
    stroke_width = 1.5
    circle_spec: dict | None = None

    for el in root.iter():
        t = _local_tag(el.tag)
        if t == "path":
            path_d = el.get("d")
            stroke_rgba = _hex_to_rgba(el.get("stroke"), stroke_rgba)
            sw = el.get("stroke-width")
            if sw:
                try:
                    stroke_width = float(sw)
                except ValueError:
                    pass
        elif t == "circle":
            try:
                circle_spec = {
                    "cx": float(el.get("cx", 0)),
                    "cy": float(el.get("cy", 0)),
                    "r": float(el.get("r", 0)),
                    "fill": _hex_to_rgba(el.get("fill"), stroke_rgba),
                }
            except (TypeError, ValueError):
                circle_spec = None

    if not path_d:
        raise ValueError(f"No <path> with d= in {svg_path}")

    return {
        "viewbox": vb,
        "path_d": path_d,
        "stroke_rgba": stroke_rgba,
        "stroke_width": stroke_width,
        "circle": circle_spec,
    }


def render_favicon_rgba(
    spec: dict,
    out_size: int,
    *,
    supersample: int = 4,
):
    """Raster the favicon paths to a square RGBA image (matches SVG viewBox aspect)."""
    from PIL import Image, ImageDraw
    from svg.path import parse_path

    min_x, min_y, vb_w, vb_h = spec["viewbox"]
    path = parse_path(spec["path_d"])
    stroke_rgba: tuple[int, int, int, int] = spec["stroke_rgba"]
    stroke_w: float = spec["stroke_width"]
    circle = spec.get("circle")

    w = h = out_size * supersample
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def tx(x: float) -> float:
        return (x - min_x) / vb_w * w

    def ty(y: float) -> float:
        return (y - min_y) / vb_h * h

    n = max(100, int(path.length() * 3))
    pts: list[tuple[float, float]] = []
    for i in range(n + 1):
        z = path.point(i / n)
        pts.append((tx(z.real), ty(z.imag)))

    line_w = max(1, round(stroke_w / vb_w * w))
    draw.line(pts + [pts[0]], fill=stroke_rgba, width=line_w, joint="curve")

    if circle:
        cx, cy, r = circle["cx"], circle["cy"], circle["r"]
        fill = circle["fill"]
        draw.ellipse(
            [tx(cx - r), ty(cy - r), tx(cx + r), ty(cy + r)],
            fill=fill,
        )

    if supersample > 1:
        img = img.resize((out_size, out_size), Image.Resampling.LANCZOS)
    return img


def write_license_rtf(out_path: Path, license_txt_path: Path):
    body = license_txt_path.read_text(encoding="utf-8").replace("\r\n", "\n")
    rtf = r"{\rtf1\ansi\deff0{\fonttbl{\f0 Consolas;}}\fs18" + "\n"
    for line in body.split("\n"):
        line = line.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
        rtf += line + r"\par" + "\n"
    rtf += "}"
    out_path.write_text(rtf, encoding="utf-8")


def write_app_icon_ico(out_path: Path, spec: dict):
    from PIL import Image

    sizes = (256, 128, 64, 48, 32, 16)
    images: list[Image.Image] = []
    for s in sizes:
        rgba = render_favicon_rgba(spec, s, supersample=4 if s >= 32 else 2)
        images.append(rgba)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    first, *rest = images
    first.save(
        out_path,
        format="ICO",
        sizes=[(im.width, im.height) for im in images],
        append_images=rest,
    )


def main():
    from PIL import Image, ImageFilter

    root = Path(__file__).resolve().parents[1]  # agent/
    repo = root.parent
    svg_path = repo / "frontend" / "public" / "favicon.svg"
    if not svg_path.is_file():
        svg_path = root / "ui-src" / "public" / "favicon.svg"
    if not svg_path.is_file():
        raise SystemExit(f"Missing favicon SVG (tried frontend/ and agent ui-src/)")

    spec = parse_frontend_favicon(svg_path)

    out_dir = root / "wix" / "assets"
    out_dir.mkdir(parents=True, exist_ok=True)

    BANNER = (493, 58)
    DIALOG = (493, 312)

    bg1 = (14, 20, 30)
    bg2 = (35, 55, 90)
    # Flat light panel: WiX draws black titles/subtitles here — keep it uniform, no dark under the text.
    panel = (244, 246, 250)

    # Top banner: keep the text area clean but replace the default WiX red disc by providing
    # our own banner with a small right-aligned branded tile.
    strip_w = 150
    img = Image.new("RGB", BANNER, panel)
    tile = vertical_gradient((44, 44), bg1, bg2).filter(ImageFilter.GaussianBlur(radius=2))
    # paste as RGB (no alpha in BMP)
    tx = BANNER[0] - 44 - 10
    ty = (BANNER[1] - 44) // 2
    img.paste(tile, (tx, ty))
    logo = render_favicon_rgba(spec, 22)
    lx = tx + (44 - logo.width) // 2
    ly = ty + (44 - logo.height) // 2
    img.paste(logo, (lx, ly), logo)
    (out_dir / "wix-banner.bmp").unlink(missing_ok=True)
    img.save(out_dir / "wix-banner.bmp", format="BMP")

    # Side graphic: single vertical strip + logo (this is the only branding image).
    img = Image.new("RGB", DIALOG, (242, 244, 248))
    left_panel = vertical_gradient((strip_w, DIALOG[1]), (11, 16, 24), (22, 34, 55))
    img.paste(left_panel, (0, 0))
    mark = render_favicon_rgba(spec, 96)
    mx = max(0, (strip_w - mark.width) // 2)
    my = (DIALOG[1] - mark.height) // 2
    img.paste(mark, (mx, my), mark)
    (out_dir / "wix-dialog.bmp").unlink(missing_ok=True)
    img.save(out_dir / "wix-dialog.bmp", format="BMP")

    repo_license = repo / "LICENSE"
    write_license_rtf(out_dir / "license.rtf", repo_license)

    ico_path = root / "icons" / "icon.ico"
    write_app_icon_ico(ico_path, spec)

    print(f"Wrote {out_dir / 'wix-banner.bmp'}")
    print(f"Wrote {out_dir / 'wix-dialog.bmp'}")
    print(f"Wrote {out_dir / 'license.rtf'}")
    print(f"Wrote {ico_path} (from {svg_path})")


if __name__ == "__main__":
    main()
