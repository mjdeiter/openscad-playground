#!/usr/bin/env python3
"""End-to-end check of per-browser persistence and file upload against a deployed or local build.

    python3 tests/e2e/persistence_upload.py https://staging.openscad.pages.dev/
    BASE=http://127.0.0.1:4173/ python3 tests/e2e/persistence_upload.py

Needs the Python `playwright` package with a Chromium browser installed.
Exit status is 0 when every check passes.
"""
import base64, json, os, sys, tempfile, time
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get('BASE', 'http://127.0.0.1:4173/')).rstrip('/') + '/'
MENU_ITEMS_JS = """() => [...document.querySelectorAll('.p-menuitem')].map(e => [e.innerText.trim(),
  !!(e.matches('.p-disabled,[aria-disabled=true],[data-p-disabled=true]') ||
     e.querySelector('.p-disabled,[aria-disabled=true],[data-p-disabled=true]'))])"""
GET_SESSION_JS = """async () => new Promise((res) => {
  const r = indexedDB.open('openscad-playground', 1);
  r.onerror = () => res(null);
  r.onupgradeneeded = () => { r.transaction.abort(); res(null); };
  r.onsuccess = () => { const db = r.result;
    if (!db.objectStoreNames.contains('kv')) return res(null);
    const g = db.transaction('kv').objectStore('kv').get('session-v1');
    g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null); };
})"""

failed = False
def check(cond, msg):
    global failed
    print(('PASS ' if cond else 'FAIL ') + msg, flush=True)
    failed = failed or not cond

def make_fixtures(d):
    # ASCII DXF with a non-UTF-8 byte in the layer name, a binary blob, and a .scad that extrudes the DXF
    pairs = [(0,'SECTION'),(2,'ENTITIES'),(0,'LWPOLYLINE'),(5,'1'),(8,'Lay\xe9r'),(90,'4'),(70,'1'),
             (10,'0'),(20,'0'),(10,'20'),(20,'0'),(10,'20'),(20,'10'),(10,'0'),(20,'10'),(0,'ENDSEC'),(0,'EOF')]
    paths = {n: os.path.join(d, n) for n in ('part.dxf', 'blob.stl', 'wrap.scad')}
    open(paths['part.dxf'], 'wb').write(''.join(f'{c}\n{v}\n' for c, v in pairs).encode('latin-1'))
    open(paths['blob.stl'], 'wb').write(bytes(range(256)) * 40 + b'\x00\xff\xfe')
    open(paths['wrap.scad'], 'w').write('linear_extrude(3) import("/part.dxf");\n')
    return paths

def session(page):
    raw = page.evaluate(GET_SESSION_JS)
    return json.loads(raw) if raw else None

def ready(page):
    page.wait_for_selector('button[title="Editor menu"]', timeout=90000)

def menu(page):
    page.click('button[title="Editor menu"]')
    items = dict(page.evaluate(MENU_ITEMS_JS))
    page.keyboard.press('Escape')
    return items

with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
    files = make_fixtures(tmp)
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1400, 'height': 900})
    page = ctx.new_page()
    page.on('dialog', lambda d: d.accept())
    page.goto(BASE); ready(page)

    items = menu(page)
    check(items.get('Upload file(s)') is False, 'Upload file(s) enabled')
    check(items.get('Share project') is False, 'Share project enabled')
    check(items.get('Download sources') is False, 'Download sources enabled')
    check('Clear my saved data' in items, 'Clear my saved data present in browser mode')
    time.sleep(2)
    check(session(page) is None, 'first visit writes no session (nothing changed yet)')

    page.set_input_files('input[type=file]', [files['part.dxf'], files['blob.stl'], files['wrap.scad']])
    page.wait_for_selector('.p-toast-message', timeout=15000)
    time.sleep(2)
    s = session(page)
    check(s is not None, 'session saved to IndexedDB after upload')
    src = {x['path']: x for x in (s or {'params': {'sources': []}})['params']['sources']}
    check(set(src) >= {'/part.dxf', '/blob.stl', '/wrap.scad', '/playground.scad'}, f'sources present: {sorted(src)}')
    for name in ('part.dxf', 'blob.stl'):
        url = src.get('/' + name, {}).get('url', '')
        got = base64.b64decode(url.split(',', 1)[1]) if url.startswith('data:') else None
        check(got == open(files[name], 'rb').read(), f'/{name} stored byte-for-byte ({len(got or b"")} bytes)')
    check(src.get('/wrap.scad', {}).get('content', '').startswith('linear_extrude'), '/wrap.scad stored as text')
    check((s or {}).get('params', {}).get('activePath') == '/wrap.scad', 'uploaded .scad became the active file')
    check(page.url.rstrip('/') == BASE.rstrip('/'), f'URL stays clean: {page.url}')

    model_src = ''
    for _ in range(60):
        model_src = page.evaluate("() => document.querySelector('model-viewer')?.getAttribute('src') || ''")
        if model_src: break
        time.sleep(1)
    check(model_src.startswith(('data:', 'blob:')), 'wrap.scad (extruded uploaded DXF) rendered a model in the viewer')

    page.reload(); ready(page); time.sleep(3)
    page.click('.p-treeselect')
    page.wait_for_selector('.p-treeselect-panel .p-treenode', timeout=15000)
    labels = page.evaluate("() => [...document.querySelectorAll('.p-treeselect-panel .p-treenode')].map(e => e.innerText.split('\\n')[0].trim())")
    check({'part.dxf', 'blob.stl', 'wrap.scad'} <= set(labels), f'uploaded files listed after reload: {labels}')
    page.keyboard.press('Escape')

    before = page.evaluate(GET_SESSION_JS)
    page2 = ctx.new_page(); page2.on('dialog', lambda d: d.accept())
    page2.goto(BASE + '#blank'); ready(page2); time.sleep(2)
    check('Clear my saved data' not in menu(page2), 'URL-fragment tab runs in URL mode (no saved-data item)')
    check(before == page.evaluate(GET_SESSION_JS), '#blank tab leaves the saved session untouched')

    ctx2 = b.new_context(viewport={'width': 1400, 'height': 900})
    p2 = ctx2.new_page(); p2.goto(BASE); ready(p2); time.sleep(2)
    check(session(p2) is None, 'a second visitor (separate profile) sees no saved session')

    page.goto(BASE); ready(page)
    page.click('button[title="Editor menu"]'); page.click('text=Clear my saved data')
    page.wait_for_load_state('load'); ready(page); time.sleep(2)
    check(session(page) is None, 'Clear my saved data wipes the session')
    b.close()

sys.exit(1 if failed else 0)
