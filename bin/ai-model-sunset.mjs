#!/usr/bin/env node
/**
 * ai-model-sunset — finds the OpenAI and Anthropic models in a project that are being switched off,
 * with the date and the official replacement. No dependencies, nothing sent anywhere: it only reads
 * files on disk and ../models.json (dates copied from the providers' deprecation pages).
 *
 *   npx -y github:ericc2005t/ai-model-sunset [path] [options]
 *
 * MIT licence. Not affiliated with OpenAI or Anthropic.
 */
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, appendFileSync } from 'node:fs';
import { join, relative, sep, extname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const DATA = JSON.parse(readFileSync(join(HERE, 'models.json'), 'utf8'));
const VERSION = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version;

// ------------------------------------------------------------------------------------------------
// Options
// ------------------------------------------------------------------------------------------------
const HELP = `ai-model-sunset ${VERSION} — find AI models in your code that are being switched off

Usage: npx -y github:ericc2005t/ai-model-sunset [path] [options]

  path                  folder to scan (default: the current one)
  --lang en|es          language of the report (default: from $LANG)
  --json                print the result as JSON
  --fail-within <days>  exit with code 1 if a model is off or shuts down within <days>
  --include-docs        also scan .md, .mdx, .txt and .rst files
  --today YYYY-MM-DD    pretend it's another day (for testing)
  --github              GitHub Actions mode: annotations, job summary, outputs
  --issue-within <days> with --github: open or update an issue when a model shuts down
                        within <days> (and close it when none does); -1 = never
  -h, --help            this help
  -v, --version         the version and the date the data was checked

Dates and replacements come from the official deprecation pages of OpenAI and Anthropic,
checked on ${DATA.checked}. Nothing is sent anywhere. Not affiliated with OpenAI or Anthropic.`;

function parseArgs(argv) {
  const o = { path: '.', lang: null, json: false, failWithin: null, docs: false, today: null, github: false, issueWithin: -1 };
  const num = (v, flag) => {
    if (v === undefined || !/^-?\d+$/.test(v)) die(`${flag} takes a number of days`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '-v' || a === '--version') { console.log(`${VERSION} (data checked ${DATA.checked})`); process.exit(0); }
    else if (a === '--json') o.json = true;
    else if (a === '--github') o.github = true;
    else if (a === '--include-docs') o.docs = true;
    else if (a === '--lang') o.lang = argv[++i];
    else if (a === '--today') o.today = argv[++i];
    else if (a === '--fail-within') { const v = argv[++i]; o.failWithin = v === '' || v === undefined ? null : num(v, a); }
    else if (a === '--issue-within') { const v = argv[++i]; o.issueWithin = v === '' || v === undefined ? -1 : num(v, a); }
    else if (a.startsWith('-')) die(`unknown option ${a} (see --help)`);
    else o.path = a;
  }
  if (o.lang !== null && o.lang !== 'en' && o.lang !== 'es') die('--lang is en or es');
  if (o.lang === null) o.lang = /^es/i.test(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || '') ? 'es' : 'en';
  if (o.today !== null && !/^\d{4}-\d{2}-\d{2}$/.test(o.today)) die('--today is YYYY-MM-DD');
  return o;
}
function die(msg) { console.error(`ai-model-sunset: ${msg}`); process.exit(2); }

// ------------------------------------------------------------------------------------------------
// Matching (the same rules as the checker at promti.app/rescue-ai/)
// ------------------------------------------------------------------------------------------------
const BY_NAME = new Map();
for (const m of DATA.models) for (const n of m.names) BY_NAME.set(n, m);
const SAFE_BY_NAME = new Map();
for (const s of DATA.safe) for (const n of s.names) SAFE_BY_NAME.set(n, s);
// names that aren't model-like words (an endpoint, a product), found as plain text
const PHRASES = DATA.models.flatMap((m) => m.names.filter((n) => /[\s/=]|^beta\.|^audio\./.test(n)).map((n) => [n, m]));
const TOKEN = /(?<![a-z0-9_-])(?:ft:)?(?:gpt-[a-z0-9._-]+|chatgpt-[a-z0-9._-]+|o[1-9](?:-[a-z0-9._-]+)?|claude-[a-z0-9._-]+|whisper-1|tts-1(?:-hd)?|dall-e-[23]|babbage-002|davinci-002|text-moderation-[a-z0-9]+|computer-use-preview[a-z0-9-]*|sora-2[a-z0-9-]*)/g;
// «o1», «o3-mini»… are short: only when quoted or set (model=o1, model: o1), never in a sentence
const SHORT = /^o[1-9]/;

/** every model named in one line: [{ model, matched }] or [{ safe, matched }] */
function matchLine(line) {
  const lower = line.toLowerCase();
  const out = [];
  if (lower.length > 4000) return out; // a minified or generated line
  TOKEN.lastIndex = 0;
  let r;
  while ((r = TOKEN.exec(lower))) {
    let name = r[0].replace(/[._:-]+$/, '');
    if (SHORT.test(name)) {
      if (line.slice(r.index, r.index + name.length) !== name) continue; // «O1» is a label, not a model
      const before = lower.slice(0, r.index).trimEnd().at(-1);
      const after = lower[r.index + r[0].length];
      if (!before || !`"'\`=:`.includes(before) || (after !== undefined && !/[\s"'`,;})\]#]/.test(after))) continue;
    }
    let ft = false;
    if (name.startsWith('ft:')) { ft = true; name = name.slice(3).split(':')[0]; }
    const model = (ft && BY_NAME.get(`ft:${name}`)) || BY_NAME.get(name);
    if (model) { out.push({ model, matched: ft ? r[0].replace(/[._:-]+$/, '') : name }); continue; }
    const safe = SAFE_BY_NAME.get(name);
    if (safe) out.push({ safe, matched: name });
  }
  for (const [phrase, model] of PHRASES) if (lower.includes(phrase)) out.push({ model, matched: phrase });
  return out;
}

// ------------------------------------------------------------------------------------------------
// Walking the project
// ------------------------------------------------------------------------------------------------
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output', '.vercel',
  '.netlify', '.wrangler', 'coverage', 'vendor', 'venv', '.venv', '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache', '.tox', 'target',
  '.gradle', 'Pods', '.terraform', '.cache', '.turbo', '.parcel-cache', 'bower_components', 'site-packages', '.idea', '.vscode', '.expo', 'DerivedData']);
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lockb', 'bun.lock', 'poetry.lock', 'Pipfile.lock',
  'uv.lock', 'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'go.sum']);
const OWN_DATA = join(HERE, 'models.json');
const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg', '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.jar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.mp4', '.mov', '.wav', '.ogg', '.webm', '.glb', '.gltf', '.bin', '.wasm', '.so', '.dylib', '.dll',
  '.exe', '.class', '.pyc', '.o', '.a', '.sqlite', '.db', '.parquet', '.pkl', '.pt', '.onnx', '.safetensors', '.map', '.lock', '.psd', '.sketch', '.fig']);
const DOCS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);
const MAX_SIZE = 2 * 1024 * 1024;

function isBinary(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).includes(0);
  } finally { closeSync(fd); }
}

function* walk(dir, docs) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(p, docs); continue; }
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (SKIP_FILES.has(e.name) || BINARY.has(ext) || /\.min\.(js|css)$/.test(e.name)) continue;
    if (!docs && DOCS.has(ext)) continue;
    if (resolve(p) === OWN_DATA) continue;
    yield p;
  }
}

function scan(root, docs) {
  const hits = new Map(); // model id -> { model, refs: [{ file, line, text, matched }] }
  const safe = new Map(); // name -> safe entry
  let files = 0;
  const st = statSync(root);
  const list = st.isFile() ? [root] : walk(root, docs);
  for (const file of list) {
    let size;
    try { size = statSync(file).size; } catch { continue; }
    if (size > MAX_SIZE || size === 0) continue;
    try { if (isBinary(file)) continue; } catch { continue; }
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    files++;
    const rel = (st.isFile() ? basename(file) : relative(root, file)).split(sep).join('/');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const f of matchLine(lines[i])) {
        if (f.safe) { safe.set(f.matched, f.safe); continue; }
        const h = hits.get(f.model.id) ?? { model: f.model, refs: [] };
        if (!h.refs.some((x) => x.file === rel && x.line === i + 1)) h.refs.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 160), matched: f.matched });
        hits.set(f.model.id, h);
      }
    }
  }
  return { files, hits: [...hits.values()], safe: [...safe.keys()].sort() };
}

// ------------------------------------------------------------------------------------------------
// Dates and words
// ------------------------------------------------------------------------------------------------
const madridToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const fmtDate = (iso, lang) => new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

const W = {
  en: {
    title: 'AI models that are being switched off',
    scanned: (n) => `${n} file${n === 1 ? '' : 's'} scanned`,
    checked: (d) => `dates checked on ${d} on the official deprecation pages`,
    none: 'No model with a shutdown date found.',
    found: (n) => `${n} model${n === 1 ? '' : 's'} with a shutdown date:`,
    gone: (d) => `switched off since ${d}`,
    goes: (d, n) => `shuts down on ${d} (${n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`})`,
    to: 'replace with', or: ' or ', noTo: 'no replacement named',
    more: (n) => `… and ${n} more`,
    page: 'What changes in the code',
    safe: 'Also found, with no shutdown date:',
    alerts: 'Get an email 30 and 7 days before each shutdown',
    fix: 'Rather not touch it? We fix it for you',
    stale: (d) => `These dates were checked on ${d}. Get the latest: npx -y github:ericc2005t/ai-model-sunset`,
    sources: 'Sources', notAffiliated: 'Not affiliated with OpenAI or Anthropic.',
  },
  es: {
    title: 'Modelos de IA que se apagan',
    scanned: (n) => `${n} archivo${n === 1 ? '' : 's'} revisado${n === 1 ? '' : 's'}`,
    checked: (d) => `fechas comprobadas el ${d} en las páginas oficiales de retiradas`,
    none: 'No hay ningún modelo con fecha de apagado.',
    found: (n) => `${n} modelo${n === 1 ? '' : 's'} con fecha de apagado:`,
    gone: (d) => `apagado desde el ${d}`,
    goes: (d, n) => `se apaga el ${d} (${n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`})`,
    to: 'cámbialo por', or: ' o ', noTo: 'sin sustituto indicado',
    more: (n) => `… y ${n} más`,
    page: 'Qué cambia en el código',
    safe: 'También hay, sin fecha de apagado:',
    alerts: 'Te avisamos por email 30 y 7 días antes de cada apagado',
    fix: '¿Te lo arreglamos?',
    stale: (d) => `Estas fechas se comprobaron el ${d}. Las últimas: npx -y github:ericc2005t/ai-model-sunset`,
    sources: 'Fuentes', notAffiliated: 'Sin relación con OpenAI ni con Anthropic.',
  },
};

/** promti.app's alerts form and quote form, with where the visit comes from and the models found */
function links(lang, src, ids) {
  const base = DATA.site[lang];
  const m = ids.length ? `&m=${ids.slice(0, 20).map(encodeURIComponent).join(',')}` : '';
  return {
    alerts: `${base}?src=${src}${m}#${lang === 'es' ? 'avisos' : 'alerts'}`,
    fix: `${base}?src=${src}#${lang === 'es' ? 'presupuesto' : 'quote'}`,
  };
}

function report(result, o) {
  const today = o.today ?? madridToday();
  const models = result.hits
    .filter((h) => h.model.off)
    .map((h) => ({ ...h, days: daysBetween(today, h.model.off) }))
    .sort((a, b) => a.days - b.days || a.model.id.localeCompare(b.model.id));
  return { today, models, safe: result.safe, files: result.files };
}

// ------------------------------------------------------------------------------------------------
// Output: terminal, JSON, GitHub
// ------------------------------------------------------------------------------------------------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c('31;1', s), yellow = (s) => c('33;1', s), dim = (s) => c('2', s), bold = (s) => c('1', s), cyan = (s) => c('36', s);

function printText(r, o) {
  const w = W[o.lang];
  const lines = [];
  lines.push(`${bold(`ai-model-sunset · ${w.title}`)}`);
  lines.push(dim(`${w.scanned(r.files)} · ${w.checked(fmtDate(DATA.checked, o.lang))}`));
  lines.push('');
  if (!r.models.length) lines.push(w.none);
  else {
    lines.push(w.found(r.models.length));
    lines.push('');
    for (const h of r.models) {
      const m = h.model;
      const when = h.days <= 0 ? red(`✖ ${w.gone(fmtDate(m.off, o.lang))}`) : h.days <= 45 ? yellow(`▲ ${w.goes(fmtDate(m.off, o.lang), h.days)}`) : `• ${w.goes(fmtDate(m.off, o.lang), h.days)}`;
      lines.push(`${bold(m.id)} ${dim(`(${m.vendor})`)}  ${when}`);
      lines.push(`  ${m.to.length ? `${w.to} ${cyan(m.to.join(w.or))}` : w.noTo}${m.note ? dim(` — ${m.note[o.lang]}`) : ''}`);
      for (const ref of h.refs.slice(0, 5)) lines.push(dim(`  ${ref.file}:${ref.line}  `) + ref.text.slice(0, 100));
      if (h.refs.length > 5) lines.push(dim(`  ${w.more(h.refs.length - 5)}`));
      if (m.page) lines.push(`  ${w.page}: ${m.page[o.lang]}`);
      lines.push('');
    }
  }
  if (r.safe.length) { lines.push(dim(`${w.safe} ${r.safe.join(', ')}`)); lines.push(''); }
  const l = links(o.lang, 'cli', r.models.map((h) => h.model.id));
  lines.push(`${w.alerts}: ${l.alerts}`);
  if (r.models.length) lines.push(`${w.fix} → ${l.fix}`);
  if (daysBetween(DATA.checked, r.today) > 60) { lines.push(''); lines.push(yellow(w.stale(DATA.checked))); }
  lines.push(dim(`${w.sources}: ${DATA.sources.OpenAI} · ${DATA.sources.Anthropic}. ${w.notAffiliated}`));
  console.log(lines.join('\n'));
}

function toJson(r) {
  return {
    tool: 'ai-model-sunset', version: VERSION, checked: DATA.checked, today: r.today, files: r.files,
    models: r.models.map((h) => ({
      id: h.model.id, vendor: h.model.vendor, off: h.model.off, daysLeft: h.days, replacement: h.model.to, page: h.model.page,
      source: DATA.sources[h.model.vendor], refs: h.refs.map(({ file, line, matched }) => ({ file, line, matched })),
    })),
    noShutdownDate: r.safe,
  };
}

// --- GitHub Actions -----------------------------------------------------------------------------
const ghEsc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const ghProp = (s) => ghEsc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const MARKER = '<!-- ai-model-sunset -->';
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function markdown(r, o, within) {
  const w = W[o.lang];
  const es = o.lang === 'es';
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const blob = (ref) => (repo && sha ? `[\`${ref.file}:${ref.line}\`](${server}/${repo}/blob/${sha}/${encodeURI(ref.file)}#L${ref.line})` : `\`${ref.file}:${ref.line}\``);
  const list = within === undefined ? r.models : r.models.filter((h) => h.days <= within);
  const rows = list.map((h) => {
    const m = h.model;
    const when = h.days <= 0 ? `**${es ? 'Apagado' : 'Off'}** ${es ? 'desde el' : 'since'} ${fmtDate(m.off, o.lang)}` : `${fmtDate(m.off, o.lang)} (${h.days} ${es ? 'días' : 'days'})`;
    const where = h.refs.slice(0, 5).map(blob).join('<br>') + (h.refs.length > 5 ? `<br>${w.more(h.refs.length - 5)}` : '');
    const to = m.to.length ? m.to.map((x) => `\`${x}\``).join(w.or) : '—';
    return `| \`${m.id}\` | ${m.vendor} | ${when} | ${to} | ${where} | [${es ? 'oficial' : 'official'}](${DATA.sources[m.vendor]})${m.page ? ` · [${es ? 'qué cambia' : 'what changes'}](${m.page[o.lang]})` : ''} |`;
  });
  const l = links(o.lang, 'action', list.map((h) => h.model.id));
  return [
    es ? `Modelos de IA de este repositorio con fecha de apagado (comprobadas el ${DATA.checked} en las páginas oficiales de OpenAI y Anthropic):`
      : `AI models in this repository with a shutdown date (checked on ${DATA.checked} on OpenAI's and Anthropic's official deprecation pages):`,
    '',
    es ? '| Modelo | Proveedor | Apagado | Sustituto oficial | Dónde | Más |' : '| Model | Provider | Shutdown | Official replacement | Where | More |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    `- ${w.alerts}: ${l.alerts}`,
    `- ${w.fix} ${l.fix}`,
    '',
    `<sub>[ai-model-sunset](https://github.com/ericc2005t/ai-model-sunset) · ${w.notAffiliated}</sub>`,
  ].join('\n');
}

async function api(method, path, body) {
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'user-agent': 'ai-model-sunset', ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = new Error(`${method} ${path}: ${res.status}`); e.status = res.status; throw e; }
  return res.status === 204 ? null : res.json();
}

async function issue(r, o) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN || o.issueWithin < 0) return;
  const es = o.lang === 'es';
  const due = r.models.filter((h) => h.days <= o.issueWithin);
  let open = null;
  try {
    for (let page = 1; page <= 5 && !open; page++) {
      const list = await api('GET', `/repos/${repo}/issues?state=open&per_page=100&page=${page}`);
      open = list.find((x) => !x.pull_request && (x.body ?? '').includes(MARKER)) ?? null;
      if (list.length < 100) break;
    }
    if (due.length) {
      const first = due[0];
      const title = first.days <= 0
        ? (es ? `Modelo de IA apagado: ${first.model.id}` : `AI model switched off: ${first.model.id}`) + (due.length > 1 ? (es ? ` y ${due.length - 1} más` : ` and ${due.length - 1} more`) : '')
        : (es ? `${first.model.id} se apaga el ${first.model.off} (en ${first.days} días)` : `${first.model.id} shuts down on ${first.model.off} (in ${first.days} days)`) + (due.length > 1 ? (es ? ` y ${due.length - 1} más` : ` + ${due.length - 1} more`) : '');
      const body = `${MARKER}\n${markdown(r, o, o.issueWithin)}`;
      if (open) {
        if (open.title !== title || open.body !== body) await api('PATCH', `/repos/${repo}/issues/${open.number}`, { title, body });
        console.log(`ai-model-sunset: issue #${open.number} updated`);
      } else {
        const made = await api('POST', `/repos/${repo}/issues`, { title, body });
        console.log(`ai-model-sunset: issue #${made.number} opened`);
      }
    } else if (open) {
      await api('POST', `/repos/${repo}/issues/${open.number}/comments`, {
        body: es ? `Ningún modelo de este repositorio se apaga en los próximos ${o.issueWithin} días. Cierro el aviso.` : `No model in this repository shuts down within the next ${o.issueWithin} days any more. Closing.`,
      });
      await api('PATCH', `/repos/${repo}/issues/${open.number}`, { state: 'closed' });
      console.log(`ai-model-sunset: issue #${open.number} closed`);
    }
  } catch (e) {
    const hint = e.status === 403 || e.status === 404 ? ' — give the workflow `permissions: issues: write`' : e.status === 410 ? ' — issues are turned off in this repository' : '';
    console.log(`::warning title=ai-model-sunset::${ghEsc(`Couldn't open or update the issue (${e.message})${hint}`)}`);
  }
}

async function github(r, o) {
  const w = W[o.lang];
  let n = 0;
  for (const h of r.models) {
    const m = h.model;
    const when = h.days <= 0 ? w.gone(m.off) : w.goes(m.off, h.days);
    const level = h.days <= 7 ? 'error' : 'warning';
    for (const ref of h.refs) {
      if (n++ >= 50) break;
      console.log(`::${level} file=${ghProp(ref.file)},line=${ref.line},title=${ghProp(`${m.id} ${when}`)}::${ghEsc(`${m.id} (${m.vendor}) ${when}. ${cap(m.to.length ? `${w.to} ${m.to.join(w.or)}` : w.noTo)}. ${m.page ? m.page[o.lang] : DATA.sources[m.vendor]}`)}`);
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const head = `## ai-model-sunset\n\n${w.scanned(r.files)}.\n\n`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${head}${r.models.length ? markdown(r, o) : w.none}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    const first = r.models[0];
    appendFileSync(process.env.GITHUB_OUTPUT, [
      `count=${r.models.length}`, `soonest-date=${first?.model.off ?? ''}`, `soonest-days=${first?.days ?? ''}`,
      `models=${r.models.map((h) => h.model.id).join(',')}`,
    ].join('\n') + '\n');
  }
  await issue(r, o);
}

// ------------------------------------------------------------------------------------------------
const o = parseArgs(process.argv.slice(2));
const root = resolve(o.path);
try { statSync(root); } catch { die(`can't read ${o.path}`); }
const r = report(scan(root, o.docs), o);
if (o.json) console.log(JSON.stringify(toJson(r), null, 2));
else printText(r, o);
if (o.github) await github(r, o);
if (o.failWithin !== null && r.models.some((h) => h.days <= o.failWithin)) process.exitCode = 1;
