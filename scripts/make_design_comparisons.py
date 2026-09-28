import os
import sys
from PIL import Image, ImageDraw, ImageFont

screens_dir = "/mnt/storage/uqi-projects/petak/docs/phase3/screens"
os.makedirs(screens_dir, exist_ok=True)

font_path_bold = "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"
font_path_regular = "/usr/share/fonts/truetype/freefont/FreeSans.ttf"

font_title = ImageFont.truetype(font_path_bold, 18)
font_label = ImageFont.truetype(font_path_bold, 15)
font_sub = ImageFont.truetype(font_path_regular, 13)

comparisons = [
    {
        "out": "design-git.png",
        "mockup": "/tmp/mockup-git.png",
        "preview": "/tmp/preview-git.png",
        "title": "PETAK P3.9 DESIGN REVIEW — Git Log View & Context Menu",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Git.html",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase3-git (?git&sub=log&menu)",
    },
    {
        "out": "design-rebase.png",
        "mockup": "/tmp/mockup-rebase.png",
        "preview": "/tmp/preview-rebase.png",
        "title": "PETAK P3.9 DESIGN REVIEW — Interactive Rebase Dialog (960x620)",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Rebase.html",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase3-git (?git&sub=log&rebase)",
    },
    {
        "out": "design-diff.png",
        "mockup": "/tmp/mockup-diff.png",
        "preview": "/tmp/preview-diff.png",
        "title": "PETAK P3.9 DESIGN REVIEW — Commit Panel & Diff View (Side-by-side / Unified)",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Diff.html",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase3-git (?git)",
    },
    {
        "out": "design-conflict.png",
        "mockup": "/tmp/mockup-conflict.png",
        "preview": "/tmp/preview-conflict.png",
        "title": "PETAK P3.9 DESIGN REVIEW — 3-Column Merge Conflict Resolver",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Conflict.html",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase3-git (?git&conflict)",
    },
]

HEADER_HEIGHT = 64
VIEW_WIDTH = 1440
VIEW_HEIGHT = 900
TOTAL_WIDTH = VIEW_WIDTH * 2
TOTAL_HEIGHT = HEADER_HEIGHT + VIEW_HEIGHT

for item in comparisons:
    print(f"Creating {item['out']}...")
    canvas = Image.new("RGB", (TOTAL_WIDTH, TOTAL_HEIGHT), "#111215")
    draw = ImageDraw.Draw(canvas)

    # Header bar
    draw.rectangle([(0, 0), (TOTAL_WIDTH, HEADER_HEIGHT)], fill="#111215")
    draw.line([(0, HEADER_HEIGHT - 1), (TOTAL_WIDTH, HEADER_HEIGHT - 1)], fill="#26282d", width=1)

    # Header title left (Mockup)
    draw.rectangle([(20, 16), (115, 46)], fill="#2e2717", outline="#4a3d22", width=1)
    draw.text((28, 22), "MOCKUP", font=font_label, fill="#f0cf8e")
    draw.text((125, 23), item["mockup_desc"], font=font_title, fill="#e6e7ea")

    # Header title right (Preview Browser)
    preview_x = VIEW_WIDTH + 20
    draw.rectangle([(preview_x, 16), (preview_x + 175, 46)], fill="#1f2a3d", outline="#3a4f75", width=1)
    draw.text((preview_x + 8, 22), "PREVIEW BROWSER", font=font_label, fill="#9cc3ff")
    draw.text((preview_x + 185, 23), item["preview_desc"], font=font_title, fill="#e6e7ea")

    # Load images
    mockup_img = Image.open(item["mockup"]).convert("RGB")
    preview_img = Image.open(item["preview"]).convert("RGB")

    # Resize if not exact 1440x900
    if mockup_img.size != (VIEW_WIDTH, VIEW_HEIGHT):
        mockup_img = mockup_img.resize((VIEW_WIDTH, VIEW_HEIGHT), Image.Resampling.LANCZOS)
    if preview_img.size != (VIEW_WIDTH, VIEW_HEIGHT):
        preview_img = preview_img.resize((VIEW_WIDTH, VIEW_HEIGHT), Image.Resampling.LANCZOS)

    # Paste
    canvas.paste(mockup_img, (0, HEADER_HEIGHT))
    canvas.paste(preview_img, (VIEW_WIDTH, HEADER_HEIGHT))

    # Center vertical divider
    draw.line([(VIEW_WIDTH, 0), (VIEW_WIDTH, TOTAL_HEIGHT)], fill="#2c2e34", width=2)

    out_path = os.path.join(screens_dir, item["out"])
    canvas.save(out_path, format="PNG", optimize=True)
    print(f"Saved: {out_path} ({os.path.getsize(out_path)} bytes)")

print("All comparison screenshots generated successfully!")
