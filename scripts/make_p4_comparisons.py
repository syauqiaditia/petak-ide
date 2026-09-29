import os
import sys
from PIL import Image, ImageDraw, ImageFont

screens_dir = "/mnt/storage/uqi-projects/petak/docs/phase4/screens"
os.makedirs(screens_dir, exist_ok=True)

font_path_bold = "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"
font_path_regular = "/usr/share/fonts/truetype/freefont/FreeSans.ttf"

font_title = ImageFont.truetype(font_path_bold, 18)
font_label = ImageFont.truetype(font_path_bold, 15)
font_sub = ImageFont.truetype(font_path_regular, 13)

comparisons = [
    {
        "out": "design-p4-main-idle.png",
        "mockup": "/tmp/mockup-main.png",
        "preview": "/mnt/storage/uqi-projects/petak/docs/phase4/screens/preview-p45-idle.png",
        "title": "PETAK P4.8 DESIGN REVIEW — Title Bar (Run/Device/Sync/Run/Debug/Stop), Rail Devices & Status Bar",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Main.html",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase4-run (?preview&idle)",
    },
    {
        "out": "design-p4-running.png",
        "mockup": "/tmp/mockup-main.png",
        "preview": "/mnt/storage/uqi-projects/petak/docs/phase4/screens/preview-p45-running.png",
        "title": "PETAK P4.8 DESIGN REVIEW — Execution State: Hot Reload (⚡), Hot Restart (↻), DevTools & Status Bar",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Main.html",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase4-run (?preview&running)",
    },
    {
        "out": "design-p4-devices.png",
        "mockup": "/tmp/mockup-main.png",
        "preview": "/mnt/storage/uqi-projects/petak/docs/phase4/screens/preview-p45-devices.png",
        "title": "PETAK P4.8 DESIGN REVIEW — Rail Devices & DevicesPanel (Connected, Virtual AVD, Gradle Daemon)",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Main.html (Rail item 4)",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase4-run (?preview&tab=devices)",
    },
    {
        "out": "design-p4-run-tab.png",
        "mockup": "/tmp/mockup-main.png",
        "preview": "/mnt/storage/uqi-projects/petak/docs/phase4/screens/preview-p45-run-tab.png",
        "title": "PETAK P4.8 DESIGN REVIEW — Bottom Panel: Run Tab (Process status, latency, controls & console)",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Main.html (Bottom Panel Tab 1)",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase4-run (?preview&running&tab=run)",
    },
    {
        "out": "design-p4-build-tab.png",
        "mockup": "/tmp/mockup-main.png",
        "preview": "/mnt/storage/uqi-projects/petak/docs/phase4/screens/preview-p45-build-tab.png",
        "title": "PETAK P4.8 DESIGN REVIEW — Bottom Panel: Build Tab (Parsed error cards with clickable file:line)",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Main.html (Bottom Panel Tab 5)",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase4-run (?preview&build-error&tab=build)",
    },
    {
        "out": "design-p4-logcat.png",
        "mockup": "/tmp/mockup-main.png",
        "preview": "/mnt/storage/uqi-projects/petak/docs/phase4/screens/preview-p46-logcat.png",
        "title": "PETAK P4.8 DESIGN REVIEW — Bottom Panel: Logcat Tab (Levels D/I/W/E + bg #2a1d1e, stack links, agent CTA)",
        "mockup_desc": "MOCKUP ACUAN: vault/Projects/Petak/design/Main.html (Logcat panel)",
        "preview_desc": "PREVIEW BROWSER: Petak UI feat/phase4-run (?preview&tab=logcat)",
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

print("All Phase 4 comparison screenshots generated successfully!")
