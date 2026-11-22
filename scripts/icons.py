"""DKT Ofis logo ve uygulama ikonlarını, uygulamanın kendi yazı tipiyle (Cormorant Garamond) Chrome'da çizerek üretir.
Kullanım: python3 scripts/icons.py   (Playwright + Chrome gerekir; Chrome yolu DKT_CHROME ile değiştirilebilir)

Görsel kimlik: pastel pembe zemin, yumuşak açık dalga, gül tonunda serif "DKT", T'nin sağ üstünde
küçük dört köşeli yıldız ve harflerin altında ince kavis. Küçük boyutlarda (favicon) yalnızca harfler ve zemin.
"""
import base64, os, pathlib
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parent.parent
font = "data:font/woff2;base64," + base64.b64encode((root / "node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2").read_bytes()).decode() if (root / "node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2").exists() else "data:font/woff2;base64," + base64.b64encode((root / "node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2").read_bytes()).decode()

BG = ('<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
      '<stop offset="0" stop-color="#fff3ee"/><stop offset="0.55" stop-color="#f8d9d9"/><stop offset="1" stop-color="#efbcc2"/></linearGradient>'
      '<linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b65d72"/><stop offset="1" stop-color="#8f4157"/></linearGradient>')

def sparkle(cx, cy, r, fill="#a84d63"):
    k = r * 0.18
    return (f'<path d="M{cx} {cy - r} C{cx + k} {cy - k} {cx + k} {cy - k} {cx + r} {cy} '
            f'C{cx + k} {cy + k} {cx + k} {cy + k} {cx} {cy + r} C{cx - k} {cy + k} {cx - k} {cy + k} {cx - r} {cy} '
            f'C{cx - k} {cy - k} {cx - k} {cy - k} {cx} {cy - r}Z" fill="{fill}"/>')

def logo_svg(rounded=True, inset=1.0, small=False, family="CG"):
    """512x512 çalışma alanı. rounded=False: tam kare (maskable / Apple, sistem köşeleri kendisi yuvarlar)."""
    rx = 116 if rounded else 0
    if small:
        content = f'<text x="256" y="338" text-anchor="middle" font-family="{family}" font-weight="700" font-size="250" letter-spacing="-10" fill="url(#ink)">DKT</text>'
    else:
        content = (
            f'<text x="250" y="322" text-anchor="middle" font-family="{family}" font-weight="700" font-size="196" letter-spacing="-4" fill="url(#ink)">DKT</text>'
            '<path d="M146 362 C 222 392 318 394 402 352" fill="none" stroke="#b65d72" stroke-opacity="0.5" stroke-width="5" stroke-linecap="round"/>'
            + sparkle(420, 138, 27)
        )
    wave = '' if small else '<path d="M372 0 C 352 156 262 232 0 262 L0 0 Z" fill="#ffffff" fill-opacity="0.38"/><path d="M512 318 C 404 338 336 398 300 512 L512 512 Z" fill="#e8a9b2" fill-opacity="0.28"/>'
    g = f'<g transform="translate({256 * (1 - inset)} {256 * (1 - inset)}) scale({inset})">'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%"><defs>{BG}'
            f'<clipPath id="clip"><rect width="512" height="512" rx="{rx}"/></clipPath></defs>'
            f'<g clip-path="url(#clip)"><rect width="512" height="512" fill="url(#bg)"/>{wave}</g>{g}{content}</g></svg>')

jobs = [
    ("public/icons/icon-192.png", 192, logo_svg()),
    ("public/icons/icon-512.png", 512, logo_svg()),
    ("public/icons/icon-maskable-512.png", 512, logo_svg(False, 0.78)),
    ("public/apple-touch-icon.png", 180, logo_svg(False)),
    ("public/icons/favicon-32.png", 32, logo_svg(small=True)),
    ("docs/kilavuz/logo.png", 256, logo_svg()),
]

if __name__ == "__main__":
    chrome = os.environ.get("DKT_CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=chrome, args=["--no-sandbox"])
        pg = b.new_page()
        for out, size, s in jobs:
            pg.set_viewport_size({"width": size, "height": size})
            pg.set_content(f'<html><head><style>@font-face{{font-family:CG;src:url("{font}") format("woff2");font-weight:700}}html,body{{margin:0;background:transparent}}</style></head><body style="width:{size}px;height:{size}px">{s}</body></html>')
            pg.evaluate("document.fonts.load('700 40px CG')"); pg.wait_for_timeout(300)
            assert pg.evaluate("document.fonts.check('700 40px CG')"), "yazı tipi yüklenmedi"
            (root / out).parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(root / out), omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})
        b.close()
    # Tarayıcı sekmesi için SVG (yazı tipi gömülemediği için serif yedeğiyle)
    (root / "public/favicon.svg").write_text(logo_svg(small=True, family="Georgia, 'Times New Roman', serif").replace(' width="100%" height="100%"', ''))
    print("ikonlar hazır")
