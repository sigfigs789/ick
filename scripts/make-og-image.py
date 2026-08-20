#!/usr/bin/env python3
"""Render public/og-image.png, the link-preview card for wordink.app.

The card used to be a hand-made PNG, so every copy change meant editing an
image nobody could regenerate. This draws it from the values below instead:
tweak the copy, re-run, commit the result.

    python3 scripts/make-og-image.py

Copy rule: the card is the first thing someone sees, usually in a group chat
they did not ask to be recruited into, so it explains the game without any of
our vocabulary. No "drop", no "infix" -- just the letters and what to do with
them.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Open Graph's canonical size. Slack, iMessage and Twitter all crop from this.
WIDTH, HEIGHT = 1200, 630
MARGIN = 96

BG = (20, 20, 20)
FG = (244, 244, 245)
FG_MUTED = (167, 170, 176)
FG_FAINT = (117, 120, 126)

# The rarity-tier dots from src/index.css (dark theme), in tier order. They read
# as "this game has a loot scale" before a single word is read.
DOTS = [
    (255, 255, 255),  # quotidian
    (59, 191, 108),  # uncommon
    (74, 143, 242),  # rare
    (171, 95, 240),  # extremely rare
    (255, 128, 0),  # legend
]
DOT_SIZE = 34
DOT_GAP = 14
DOT_RADIUS = 9

# Libre Franklin and Karla are webfonts we do not ship, and a preview card is
# never rendered in a browser, so this borrows the closest thing macOS has.
FONT_DIR = Path("/System/Library/Fonts")
DISPLAY = FONT_DIR / "HelveticaNeue.ttc"
BODY = FONT_DIR / "HelveticaNeue.ttc"
# Face indexes inside the .ttc.
BOLD, REGULAR, MEDIUM = 1, 0, 10

WORDMARK = "WordInk"
LINES = [
    "Everyone gets the same few letters each day.",
    "Find the rarest real word that contains them.",
]
# One example, the way the original card did it: the letters, then the same
# letters found inside a word. "Letters:" rather than "Drop:" -- the shape is
# what reads well, the label was the jargon.
EXAMPLE_LABEL = "Letters:"
EXAMPLE_LETTERS = "INK"
EXAMPLE_WORD = ("th", "INK", "er")
FOOTER = "Five guesses  ·  No timer, no login  ·  wordink.app"


def font(path: Path, index: int, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size, index=index)


def draw_dots(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    for i, color in enumerate(DOTS):
        left = x + i * (DOT_SIZE + DOT_GAP)
        draw.rounded_rectangle(
            (left, y, left + DOT_SIZE, y + DOT_SIZE), DOT_RADIUS, fill=color
        )


def draw_runs(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    runs: list[tuple[str, ImageFont.FreeTypeFont, tuple[int, int, int]]],
) -> int:
    """Draw text pieces on one baseline, returning where the line ended."""
    for text, text_font, color in runs:
        draw.text((x, y), text, font=text_font, fill=color)
        x += int(draw.textlength(text, font=text_font))
    return x


def render() -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)

    wordmark_font = font(DISPLAY, BOLD, 104)
    line_font = font(BODY, REGULAR, 38)
    example_base = font(BODY, REGULAR, 44)
    example_hit = font(BODY, BOLD, 44)
    letters_font = font(DISPLAY, BOLD, 44)
    label_font = font(DISPLAY, BOLD, 44)
    footer_font = font(BODY, MEDIUM, 26)

    draw_dots(draw, MARGIN, 96)
    draw.text((MARGIN - 6, 158), WORDMARK, font=wordmark_font, fill=FG)

    y = 306
    for line in LINES:
        draw.text((MARGIN, y), line, font=line_font, fill=FG_MUTED)
        y += 54

    # "INK" alone, then the same three letters found inside a real answer.
    y = 448
    before, hit, after = EXAMPLE_WORD
    x = draw_runs(draw, MARGIN, y, [(EXAMPLE_LABEL, label_font, FG_FAINT)])
    x = draw_runs(draw, x + 22, y, [(EXAMPLE_LETTERS, letters_font, FG)])
    draw_runs(
        draw,
        x + 52,
        y,
        [
            (before, example_base, FG_MUTED),
            (hit, example_hit, FG),
            (after, example_base, FG_MUTED),
        ],
    )

    draw.text((MARGIN, HEIGHT - 96), FOOTER, font=footer_font, fill=FG_FAINT)
    return image


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "og-image.png"
    render().save(out, optimize=True)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
