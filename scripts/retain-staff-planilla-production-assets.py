"""Retain public live/previous Firebase assets without changing build/index.html.

Uses the inherited HTTPS proxy and default CA verification. Only same-origin
/assets/* and /vite.svg responses with an appropriate asset MIME are retained.
Existing files are compared and never overwritten. No credentials are used.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import os
import posixpath
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


ORIGIN = 'https://lc-scheduler.web.app'
ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
REPORT = ROOT / 'output/staff-planilla-qa/previous-live-assets.json'
EXTENSIONS = r'(?:js|mjs|css|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot)'
EXTENSION_PATTERN = re.compile(r'\.' + EXTENSIONS + r'(?:[?#].*)?$', re.I)
LITERALS = re.compile(r'''(["'`])([^"'`\r\n]{1,280})\1''')
CSS_URLS = re.compile(r'url\(\s*([^)]+?)\s*\)', re.I)
KNOWN_RELEASES = {
    '/assets/index-BeH5Pe5h.js', '/assets/index-VBFEW1Bo.js',
    '/assets/index-BWcnu6Yd.js', '/assets/index-BHW2FE_0.js',
}
MARKERS = ['Avances', 'TrainingProgressReport', 'Ordenar carnet',
           'Permanencia', 'RRHH', 'Subir Usuarios Activos', 'Excel BUK',
           'Excel planificación', 'Importar planilla BUK', 'Feriados acumulados',
           'Avances de entrenamiento',
           'Consulta el dominio por posición y el progreso de cada colaborador.',
           'Análisis de Capacitación Global', 'Tasa de dominio por posición (%)',
           'Archivo de horarios', 'Ordenar carnets por vencimiento',
           'Descansos de la semana', 'Por completar, sin contar este día:',
           'Refrigerio BUK:', 'REFRIGERIOS',
           '5 turnos de 4 h 45 min. Sin break.']


class HtmlAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
        self.modules = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        for name in ('src', 'href'):
            if attributes.get(name):
                self.references.append(attributes[name])
        if tag == 'script' and attributes.get('type') == 'module' and attributes.get('src'):
            self.modules.append(attributes['src'])
        if attributes.get('srcset'):
            self.references.extend(part.strip().split()[0] for part in attributes['srcset'].split(',') if part.strip())


def digest(content):
    return hashlib.sha256(content).hexdigest()


def canonical(reference, parent='/'):
    value = reference.strip().strip('"\'')
    if not value or '${' in value or '\\' in value or not EXTENSION_PATTERN.search(value):
        return None
    if value.startswith(('data:', 'blob:', '#')):
        return None
    # Vite's dependency-map strings are relative to the hosting root even when
    # they occur in /assets/main.js. Other imports are relative to their module.
    resolved = urllib.parse.urljoin(ORIGIN + ('/' if value.startswith('assets/') else parent), value)
    parsed = urllib.parse.urlsplit(resolved)
    if f'{parsed.scheme}://{parsed.netloc}' != ORIGIN:
        return None
    path = posixpath.normpath(parsed.path)
    if path != '/vite.svg' and not path.startswith('/assets/'):
        return None
    if any(part in ('..', '.') for part in path.split('/')):
        return None
    if Path(path).stem in ('', '.'):
        return None
    return path


def references(content, parent):
    text = content.decode('utf-8')
    values = []
    for match in LITERALS.finditer(text):
        value = match.group(2)
        # Bundled package metadata contains strings such as "./lib/elliptic.js"
        # and "bn.js" which are not browser imports. Vite's emitted file names
        # are hashed; absolute/root-relative assets are explicit references.
        hashed = re.search(r'-[A-Za-z0-9_-]{8}\.' + EXTENSIONS + r'(?:[?#].*)?$', value, re.I)
        if value.startswith(('/assets/', 'assets/')) or hashed:
            values.append(value)
    if Path(parent).suffix.lower() == '.css':
        values.extend(match.group(1) for match in CSS_URLS.finditer(text))
    values.extend(match.group(2) for match in re.finditer(r'''new\s+URL\(\s*(["'])([^"']+)\1\s*,\s*import\.meta\.url''', text))
    return {path for value in values if (path := canonical(value, parent))}


def allowed_mime(path, mime):
    mime = mime.split(';', 1)[0].strip().lower()
    suffix = Path(path).suffix.lower()
    if suffix in ('.js', '.mjs'):
        return mime in ('application/javascript', 'text/javascript', 'application/ecmascript', 'text/ecmascript', 'application/x-javascript')
    if suffix == '.css':
        return mime == 'text/css'
    if suffix in ('.woff', '.woff2', '.ttf', '.otf', '.eot'):
        return mime.startswith('font/') or mime in ('application/font-woff', 'application/x-font-ttf', 'application/x-font-opentype', 'application/vnd.ms-fontobject', 'application/octet-stream')
    return mime.startswith('image/')


def fetch(path, is_html=False):
    request = urllib.request.Request(ORIGIN + path, headers={'Cache-Control': 'no-cache', 'User-Agent': 'Horarios asset preservation verification'})
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            content = response.read()
            status = response.status
            mime = response.headers.get('Content-Type', '')
            final = urllib.parse.urlsplit(response.geturl())
            if f'{final.scheme}://{final.netloc}' != ORIGIN:
                return {'path': path, 'error': 'cross-origin redirect', 'status': status}
            if status != 200:
                return {'path': path, 'error': 'non-200 response', 'status': status, 'mime': mime}
            if not is_html and (not allowed_mime(path, mime) or content.lstrip().lower().startswith((b'<!doctype html', b'<html'))):
                return {'path': path, 'error': 'not a valid asset MIME/body (possible SPA fallback)', 'status': status, 'mime': mime}
            return {'path': path, 'status': status, 'mime': mime, 'content': content}
    except urllib.error.HTTPError as error:
        return {'path': path, 'error': 'HTTP error', 'status': error.code, 'mime': error.headers.get('Content-Type', '')}
    except Exception as error:
        return {'path': path, 'error': str(error)}


def retain(path, content):
    destination = BUILD / path.lstrip('/')
    assert destination.is_relative_to(BUILD)
    assert destination.name != 'index.html'
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.retain-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
        try:
            # Atomic publication only if absent; an existing file is never replaced.
            os.link(temporary, destination)
            return 'downloaded'
        except FileExistsError:
            for attempt in range(3):
                existing = destination.read_bytes()
                if existing == content:
                    return 'already-present'
                # A concurrent Vite build may be in the middle of writing a file.
                if attempt < 2:
                    time.sleep(0.1)
            raise AssertionError(f'Existing asset differs from live bytes: {path}')
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


html = fetch('/admin', is_html=True)
if 'error' in html:
    raise RuntimeError(html)
assert html['mime'].split(';', 1)[0] == 'text/html'
parser = HtmlAssets(); parser.feed(html['content'].decode('utf-8'))
assert len(parser.modules) == 1, 'Expected one current live module entrypoint'
live_main = canonical(parser.modules[0], '/admin')
assert live_main
required = {path for value in parser.references if (path := canonical(value, '/admin'))}
optional = set(KNOWN_RELEASES)
# Seed actual release filenames recorded in repository deployment documents.
for document in (ROOT / 'docs').rglob('*.md'):
    text = document.read_text(errors='replace')
    for filename in re.findall(r'\b(?:index|CompetitionApp|bukPlanningPDF|weeklyScheduleExcel|papaparse\.min|index\.es)-[A-Za-z0-9_-]{6,}\.(?:js|css)\b', text):
        optional.add('/assets/' + filename)
# Local build history is only a source of optional public-file names. New,
# unpublished bundles produce the Hosting HTML fallback and are never retained.
for existing in (BUILD / 'assets').rglob('*'):
    if existing.is_file() and EXTENSION_PATTERN.search(existing.name):
        optional.add('/' + existing.relative_to(BUILD).as_posix())
queue = required | optional
visited = set()
results = []
unavailable = []
errors = []
main_bytes = None
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as workers:
    while queue:
        batch = queue - visited
        queue = set()
        futures = {workers.submit(fetch, path): path for path in sorted(batch)}
        visited.update(batch)
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            path = result['path']
            if 'error' in result:
                if path in required:
                    errors.append(result)
                else:
                    unavailable.append(result)
                continue
            content = result.pop('content')
            try:
                action = retain(path, content)
            except Exception as error:
                errors.append({**result, 'error': str(error)})
                continue
            result.update({'sha256': digest(content), 'bytes': len(content), 'action': action})
            results.append(result)
            if path == live_main:
                main_bytes = content
            if Path(path).suffix.lower() in ('.js', '.mjs', '.css'):
                linked = references(content, path)
                # References from an available release must also remain available.
                required.update(linked)
                queue.update(linked - visited)

assert main_bytes is not None, 'Current live main could not be retained'
decoded = re.sub(r'\\u([0-9a-fA-F]{4})', lambda match: chr(int(match.group(1), 16)), main_bytes.decode('utf-8'))
report = {
    'status': 'PASS' if not errors else 'FAIL',
    'verifiedAt': datetime.now(timezone.utc).isoformat(),
    'origin': ORIGIN,
    'liveHtmlPath': '/admin',
    'liveHtmlSha256': digest(html['content']),
    'liveMain': live_main,
    'liveMainSha256': digest(main_bytes),
    'liveMainMarkers': {marker: {'present': marker in decoded, 'count': decoded.count(marker)} for marker in MARKERS},
    'retainedAssetCount': len(results),
    'newlyDownloaded': sum(result['action'] == 'downloaded' for result in results),
    'assets': sorted(results, key=lambda result: result['path']),
    'optionalReleaseSeedsUnavailable': sorted(unavailable, key=lambda result: result['path']),
    'errors': sorted(errors, key=lambda result: result['path']),
    'buildIndexHtmlWritten': False,
    'credentialsUsed': False,
}
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps({key: report[key] for key in ('status', 'liveMain', 'liveMainSha256', 'liveMainMarkers', 'retainedAssetCount', 'newlyDownloaded', 'errors')}, ensure_ascii=False))
if errors:
    raise SystemExit(1)
