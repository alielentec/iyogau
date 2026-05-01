#!/usr/bin/env python3
# One-shot helper: injects security headers, favicon links, and Open
# Graph / Twitter meta into the <head> of every legal page. Idempotent
# (skips files that already have the markers). Run after creating any
# new legal page so it picks up the same head treatment.

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGES = [
    ("privacy/california/index.html", "https://iyogau.com/privacy/california/", "article"),
    ("privacy/china/index.html",      "https://iyogau.com/privacy/china/",      "article"),
    ("privacy/korea/index.html",      "https://iyogau.com/privacy/korea/",      "article"),
    ("terms/index.html",              "https://iyogau.com/terms/",              "article"),
    ("health-disclaimer/index.html",  "https://iyogau.com/health-disclaimer/",  "article"),
    ("accessibility/index.html",      "https://iyogau.com/accessibility/",      "article"),
]

CSP = ('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; '
       'script-src \'self\' \'unsafe-inline\'; '
       'style-src \'self\' \'unsafe-inline\' https://fonts.googleapis.com; '
       'font-src \'self\' https://fonts.gstatic.com; '
       'img-src \'self\' data:; connect-src \'self\'; '
       'base-uri \'self\'; form-action \'self\'; frame-ancestors \'none\';" />')

SECURITY = (
    CSP + '\n'
    '<meta http-equiv="X-Content-Type-Options" content="nosniff" />\n'
    '<meta name="referrer" content="strict-origin-when-cross-origin" />\n'
)

FAVICONS = (
    '<link rel="icon" type="image/x-icon" href="/favicon.ico" />\n'
    '<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/favicon-32.png" />\n'
    '<link rel="icon" type="image/png" sizes="16x16" href="/assets/img/favicon-16.png" />\n'
    '<link rel="apple-touch-icon" sizes="180x180" href="/assets/img/apple-touch-icon.png" />\n'
)

def og_block(title, description, url, og_type):
    # Escape quotes in description
    desc_attr = description.replace('"', '&quot;')
    title_attr = title.replace('"', '&quot;')
    return (
        f'<meta property="og:type" content="{og_type}" />\n'
        f'<meta property="og:title" content="{title_attr}" />\n'
        f'<meta property="og:description" content="{desc_attr}" />\n'
        f'<meta property="og:url" content="{url}" />\n'
        '<meta property="og:site_name" content="iYogaU" />\n'
        '<meta property="og:image" content="https://iyogau.com/assets/img/og.png" />\n'
        '<meta property="og:image:width" content="1200" />\n'
        '<meta property="og:image:height" content="630" />\n'
        '<meta name="twitter:card" content="summary_large_image" />\n'
        '<meta name="twitter:image" content="https://iyogau.com/assets/img/og.png" />'
    )

def process(path: Path, url: str, og_type: str):
    text = path.read_text(encoding="utf-8")

    if 'Content-Security-Policy' in text and 'og:image' in text:
        print(f"  skipped {path.relative_to(ROOT)} (already has CSP and og:image)")
        return

    # Pull <title> and meta description for OG fallback content.
    title_match = re.search(r"<title>([^<]+)</title>", text)
    desc_match = re.search(r'<meta name="description" content="([^"]+)"', text)
    if not title_match or not desc_match:
        print(f"  WARN {path.relative_to(ROOT)}: missing title or description")
        return
    title = title_match.group(1).strip()
    description = desc_match.group(1).strip()

    # Insert security meta immediately AFTER the theme-color meta (before
    # the inline theme-init <script>). This block lives near the top of
    # <head>, so CSP applies before the script-src 'unsafe-inline' usage.
    if 'Content-Security-Policy' not in text:
        text = re.sub(
            r'(<meta name="theme-color" content="#0f1413" media="\(prefers-color-scheme: dark\)" />\n)',
            r'\1\n' + SECURITY,
            text,
            count=1,
        )

    # Insert favicon links AFTER the closing </script> of the theme-init
    # block (one occurrence in <head>; we want it after script and before
    # the <title>).
    if 'favicon-32.png' not in text:
        text = re.sub(
            r"(</script>\n)",
            r"\1\n" + FAVICONS,
            text,
            count=1,
        )

    # Insert OG/Twitter block right AFTER the canonical <link>.
    if 'og:image' not in text:
        og = og_block(title, description, url, og_type)
        text = re.sub(
            r'(<link rel="canonical" href="[^"]+" />\n)',
            r'\1\n' + og + '\n',
            text,
            count=1,
        )

    path.write_text(text, encoding="utf-8")
    print(f"  patched {path.relative_to(ROOT)}")


def main():
    print("Injecting security meta + favicons + OG into legal pages:")
    for rel, url, og_type in PAGES:
        process(ROOT / rel, url, og_type)


if __name__ == "__main__":
    main()
