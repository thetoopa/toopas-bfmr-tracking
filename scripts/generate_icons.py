from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "web" / "icons"


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def make_icon(size: int) -> None:
    image = Image.new("RGB", (size, size), "#047d78")
    draw = ImageDraw.Draw(image)
    inset = int(size * 0.1)
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=int(size * 0.18),
        fill="#ffffff",
    )
    draw.rounded_rectangle(
        (inset + int(size * 0.045), inset + int(size * 0.045), size - inset - int(size * 0.045), size - inset - int(size * 0.045)),
        radius=int(size * 0.13),
        fill="#eef4f2",
    )
    draw.rectangle(
        (inset + int(size * 0.06), inset + int(size * 0.19), size - inset - int(size * 0.06), inset + int(size * 0.27)),
        fill="#4655a7",
    )
    draw.rectangle(
        (inset + int(size * 0.06), inset + int(size * 0.32), size - inset - int(size * 0.06), inset + int(size * 0.38)),
        fill="#13795b",
    )
    draw.rectangle(
        (inset + int(size * 0.06), inset + int(size * 0.43), size - inset - int(size * 0.22), inset + int(size * 0.49)),
        fill="#b7791f",
    )

    label_font = font(int(size * 0.22))
    text = "BFMR"
    bbox = draw.textbbox((0, 0), text, font=label_font)
    draw.text(
        ((size - (bbox[2] - bbox[0])) / 2, size * 0.62),
        text,
        font=label_font,
        fill="#18222f",
    )
    image.save(ICON_DIR / f"icon-{size}.png")


if __name__ == "__main__":
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for icon_size in (180, 192, 512):
        make_icon(icon_size)
