const SB_URL = 'https://htufjjctlblfbmysyofx.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0dWZqamN0bGJsZmJteXN5b2Z4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDI3ODgsImV4cCI6MjA5NDMxODc4OH0.hb3DJWap4MKG8rnkI1AsDmKqrAuubQEZKpYbDD4px2I';
const HEADERS = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
const SB_BUCKET = 'pdfs';

async function uploadPdfToSupabase(file, onProgress) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = Date.now() + '_' + safeName;
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', SB_URL + '/storage/v1/object/' + SB_BUCKET + '/' + encodeURIComponent(path));
    xhr.setRequestHeader('apikey', SB_KEY);
    xhr.setRequestHeader('Authorization', 'Bearer ' + SB_KEY);
    xhr.setRequestHeader('Content-Type', 'application/pdf');
    xhr.setRequestHeader('x-upsert', 'false');
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error('Storage ' + xhr.status + ': ' + xhr.responseText));
    };
    xhr.onerror = () => reject(new Error('Erreur réseau upload'));
    xhr.send(file);
  });
  return SB_URL + '/storage/v1/object/public/' + SB_BUCKET + '/' + encodeURIComponent(path);
}

/** Début de la journée locale (navigateur), en ISO UTC pour PostgREST. */
function startOfTodayIso() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}

/** Tous les articles encore visibles dans la liste de saisie (sans filtre de date). */
async function sbGet() {
  const qs =
    'select=*' +
    '&is_published=eq.true' +
    '&saisie_visible=eq.true' +
    '&order=created_at.desc';
  const r = await fetch(SB_URL + '/rest/v1/articles?' + qs, {
    headers: { ...HEADERS, 'Range': '0-9999', 'Prefer': 'count=exact' },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Articles du jour encore visibles (utilisé par Actualiser pour fusionner). */
async function sbGetToday() {
  const since = startOfTodayIso();
  const qs =
    'select=*' +
    '&is_published=eq.true' +
    '&saisie_visible=eq.true' +
    '&created_at=gte.' + encodeURIComponent(since) +
    '&order=created_at.desc';
  const r = await fetch(SB_URL + '/rest/v1/articles?' + qs, {
    headers: { ...HEADERS, 'Range': '0-9999', 'Prefer': 'count=exact' },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Masque tous les articles visibles de la liste de saisie (partout), sans dépublier. */
async function sbClearSaisieList() {
  const qs = 'saisie_visible=eq.true';
  const r = await fetch(SB_URL + '/rest/v1/articles?' + qs, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ saisie_visible: false }),
  });
  if (!r.ok) throw new Error(await r.text());
}
async function sbInsert(row) {
  const r = await fetch(SB_URL + '/rest/v1/articles', { method: 'POST', headers: HEADERS, body: JSON.stringify(row) });
  if (!r.ok) {
    const text = await r.text();
    const err = new Error(text);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return r.json();
}
async function sbUpdate(id, patch) {
  const r = await fetch(SB_URL + '/rest/v1/articles?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbDelete(id) {
  const r = await fetch(SB_URL + '/rest/v1/articles?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: HEADERS });
  if (!r.ok) throw new Error(await r.text());
}
async function sbCheckDuplicate(url) {
  const r = await fetch(
    SB_URL + '/rest/v1/articles?url=eq.' + encodeURIComponent(url) +
    '&select=id,url,title,categorie,indicateur,langue,image_url,is_published',
    { headers: HEADERS }
  );
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data[0] || null;
}
function isUniqueViolation(err) {
  const body = (err && (err.body || err.message)) || '';
  return /23505|duplicate key|unique/i.test(String(body));
}

async function fetchOgData(url) {
  try {
    const r = await fetch('https://api.microlink.io/?url=' + encodeURIComponent(url));
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data || null;
  } catch { return null; }
}

let entries = [];
let pendingDup = null;
let selEmoji = '';
let selContract = '';
let selCountry = '';
let urlCheckTimeout = null;

const syncBadge = document.getElementById('sync-badge');
function setSync(state, msg) {
  syncBadge.textContent = msg || '';
  syncBadge.className = 'sync-badge' + (state ? ' ' + state : '');
}

async function loadEntries() {
  try {
    setSync('syncing', '↻ chargement…');
    entries = await sbGet();
    setSync('', '');
  } catch (e) {
    setSync('error', '⚠ connexion');
    entries = [];
  }
  renderList();
}

document.getElementById('refresh-btn').addEventListener('click', async () => {
  try {
    setSync('syncing', '↻ actualisation…');
    const today = await sbGetToday();
    const byId = new Map(entries.map(e => [e.id, e]));
    for (const a of today) byId.set(a.id, a);
    entries = Array.from(byId.values()).sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
    setSync('', '');
  } catch (e) {
    console.error(e);
    setSync('error', '⚠ connexion');
  }
  renderList();
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!entries.length) return;
  const ok = await confirmModal({
    title: 'Vider la liste ?',
    sub: 'La liste sera vidée sur tous les appareils (mobile, PC…). Les articles restent publiés sur l\'app.',
    confirmLabel: 'Vider',
  });
  if (!ok) return;
  try {
    setSync('syncing', '↻ vidage…');
    await sbClearSaisieList();
    entries = [];
    setSync('', '');
    renderList();
  } catch (e) {
    console.error(e);
    setSync('error', '⚠ erreur vidage');
  }
});

function renderList() {
  const el = document.getElementById('entry-list');
  const wrap = document.getElementById('copy-wrap');
  const clearB = document.getElementById('clear-btn');
  document.getElementById('list-title').textContent = entries.length
    ? 'Liste (' + entries.length + ')'
    : 'Liste';
  clearB.style.display = entries.length ? '' : 'none';
  if (!entries.length) {
    el.innerHTML = '<div class="empty-state">Aucun article — Actualiser synchronise les articles du jour</div>';
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  el.innerHTML = entries.map((e) => {
    const domain = (() => { try { return new URL(e.url).hostname.replace(/^www\./, ''); } catch { return e.url; } })();
    return '<div class="entry">' + domain + '</div>';
  }).join('');
}

function confirmModal({ title, sub, confirmLabel }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-sub').textContent = sub;
    document.getElementById('modal-confirm').textContent = confirmLabel || 'Confirmer';
    modal.classList.add('open');
    const cleanup = (val) => {
      modal.classList.remove('open');
      document.getElementById('modal-confirm').onclick = null;
      document.getElementById('modal-cancel').onclick = null;
      resolve(val);
    };
    document.getElementById('modal-confirm').onclick = () => cleanup(true);
    document.getElementById('modal-cancel').onclick = () => cleanup(false);
  });
}

loadEntries();
