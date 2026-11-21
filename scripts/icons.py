"""DKT Ofis uygulama ikonlarını, uygulamanın kendi yazı tipiyle Chrome'da çizerek üretir.
Kullanım: python3 scripts/icons.py   (Playwright + Chrome gerekir)"""
import pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
import base64
font = "data:font/woff2;base64," + base64.b64encode((root / "node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-600-normal.woff2").read_bytes()).decode()
def svg(rounded=True, inset=1.0, small=False):
    rx = 15 if rounded else 0
    text = ('<text x="32" y="43" text-anchor="middle" font-family="CG" font-weight="600" font-size="31" fill="#fbf4f0">DKT</text>' if small else '<text x="32" y="38" text-anchor="middle" font-family="CG" font-weight="600" font-size="24" letter-spacing="0.8" fill="#fbf4f0">DKT</text>')
    line = '' if small else '<line x1="24" y1="45.5" x2="40" y2="45.5" stroke="#fbf4f0" stroke-opacity="0.7" stroke-width="1.2" stroke-linecap="round"/>'
    g = f'<g transform="translate({32*(1-inset)} {32*(1-inset)}) scale({inset})">' 
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c09391"/><stop offset="1" stop-color="#93605e"/></linearGradient></defs>
<rect width="64" height="64" rx="{rx}" fill="url(#g)"/>{g}
{text}
{line}</g></svg>'''
jobs = [("public/icons/icon-192.png", 192, svg()), ("public/icons/icon-512.png", 512, svg()),
        ("public/icons/icon-maskable-512.png", 512, svg(False, 0.8)), ("public/apple-touch-icon.png", 180, svg(False)),
        ("public/icons/favicon-32.png", 32, svg(small=True))]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    pg = b.new_page()
    for out, size, s in jobs:
        pg.set_viewport_size({"width": size, "height": size})
        pg.set_content(f'<html><head><style>@font-face{{font-family:CG;src:url("{font}") format("woff2");font-weight:600}}html,body{{margin:0;background:transparent}}</style></head><body style="width:{size}px;height:{size}px">{s}</body></html>')
        pg.evaluate("document.fonts.ready.then(() => document.fonts.check('600 24px CG'))"); pg.wait_for_timeout(250)
        assert pg.evaluate("document.fonts.check('600 24px CG')"), "yazı tipi yüklenmedi"
        pg.screenshot(path=str(root / out), omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})
    b.close()
# favicon.svg: tarayıcı sekmesi için (yazı tipi gömülemediği için serif yedeğiyle)
(root / "public/favicon.svg").write_text(svg(small=True).replace('font-family="CG"', 'font-family="Georgia, serif"').replace('width="100%" height="100%"', ''))
print("ikonlar hazır")
