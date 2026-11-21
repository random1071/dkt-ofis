import os, shutil, json, time
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:4173/"
CHROME = "/usr/bin/google-chrome"
SHOTS = "/home/claude/e2e/shots"
os.makedirs(SHOTS, exist_ok=True)
PW = "Ezgi-Test-2026!"

def launch(p, profile, mobile=False, fresh=False):
    if fresh and os.path.exists(profile):
        shutil.rmtree(profile)
    kw = dict(executable_path=CHROME, headless=True, accept_downloads=True, locale="tr-TR", timezone_id="Europe/Istanbul",
              args=["--no-sandbox", "--disable-dev-shm-usage"])
    if mobile:
        kw.update(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                  user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    else:
        kw.update(viewport={"width": 1440, "height": 900})
    ctx = p.chromium.launch_persistent_context(profile, **kw)
    return ctx

def attach_console(page, errors):
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error",) else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

def shot(page, name, full=False):
    page.screenshot(path=f"{SHOTS}/{name}.png", full_page=full)

def toast_text(page):
    return page.locator(".toast").all_inner_texts()

def click_text(page, text, exact=False):
    page.get_by_role("button", name=text, exact=exact).first.click()
