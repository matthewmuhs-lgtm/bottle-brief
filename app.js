import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import * as L from './logic.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const QUEUE_KEY = 'bb_queue_v1';
const PREFS_KEY = 'bb_prefs_v1';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let user = null;
let server = [];          // bottles from Supabase (not deleted)
let queue = loadJson(QUEUE_KEY, []);   // changes waiting to reach Supabase
let view = 'today';
let period = 'week';
let openDay = null;
let sheet = null;         // { mode: 'new' | 'edit', id, type }
let pendingEmail = '';
let started = false;

// ---------- small helpers ----------
function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2600);
}
function setStatus(msg) { $('status').textContent = msg; }
function isNetworkError(e) {
  if (!navigator.onLine) return true;
  return /fetch|network|load failed/i.test(String(e?.message ?? e));
}
const TYPE_NAME = { breast_milk: 'Breast milk', formula: 'Formula', mixed: 'Mixed', unknown: 'Type not recorded' };
const ozText = (b) => (b.total_oz == null ? 'Amount not recorded' : L.fmtOz(b.total_oz));
const byTime = (a, b) => new Date(a.started_at) - new Date(b.started_at);
function fmtDay(key) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- data: server rows plus queued local changes ----------
// What the screens show: server rows with queued (offline) changes applied on top.
function visible() {
  let list = server.map((b) => ({ ...b }));
  for (const op of queue) {
    if (op.op === 'insert') {
      list.push({ ...op.row, id: op.tmpId, created_at: op.createdAt });
    } else if (op.op === 'update') {
      const b = list.find((x) => x.id === op.id);
      if (b) Object.assign(b, op.patch);
    } else if (op.op === 'delete') {
      list = list.filter((x) => x.id !== op.id);
    }
  }
  return list.sort(byTime);
}

async function fetchServer() {
  const { data, error } = await sb.from('bottles')
    .select('id,started_at,local_day,bottle_type,breast_milk_oz,formula_oz,total_oz,source,created_at')
    .is('deleted_at', null)
    .order('started_at', { ascending: true })
    .limit(5000);
  if (error) {
    if (!isNetworkError(error)) toast(`Could not load bottles: ${error.message}`);
    return false;
  }
  server = data;
  return true;
}

// Sends queued changes in order. Stops on a network error so nothing is lost.
async function flush() {
  while (queue.length && navigator.onLine && user) {
    const op = queue[0];
    let res;
    try {
      if (op.op === 'insert') {
        res = await sb.from('bottles').insert(op.row).select('id').single();
        if (!res.error) {
          const realId = res.data.id;
          queue.forEach((q) => { if (q.id === op.tmpId) q.id = realId; });
        }
      } else if (op.op === 'update') {
        res = await sb.from('bottles').update(op.patch).eq('id', op.id);
      } else if (op.op === 'delete') {
        res = await sb.from('bottles').update({ deleted_at: new Date().toISOString() }).eq('id', op.id);
      }
    } catch (e) {
      res = { error: e };
    }
    if (res?.error) {
      if (isNetworkError(res.error)) break;
      toast(`A change could not be saved: ${res.error.message}`);
    }
    queue.shift();
    saveJson(QUEUE_KEY, queue);
  }
}

// Push queued changes, reload from the server, redraw.
async function sync() {
  if (!user) return;
  setStatus(navigator.onLine ? 'Syncing…' : 'Offline');
  await flush();
  if (navigator.onLine) await fetchServer();
  render();
  setStatus(queue.length ? `${queue.length} change${queue.length > 1 ? 's' : ''} waiting to sync` : '');
}

function enqueue(op) {
  queue.push(op);
  saveJson(QUEUE_KEY, queue);
  render();
  sync();
}

function addBottle(fields) {
  const tmpId = `tmp-${Math.random().toString(36).slice(2)}`;
  const row = {
    started_at: fields.started_at,
    local_day: fields.local_day,
    bottle_type: fields.bottle_type,
    breast_milk_oz: fields.breast_milk_oz,
    formula_oz: fields.formula_oz,
    total_oz: fields.total_oz,
    time_zone: L.TZ,
    source: 'app',
    created_by: user?.id ?? null,
  };
  enqueue({ op: 'insert', tmpId, row, createdAt: new Date().toISOString() });
}

function updateBottle(id, fields) {
  enqueue({ op: 'update', id, patch: fields });
}

function deleteBottle(id) {
  enqueue({ op: 'delete', id });
}

// ---------- rendering ----------
function render() {
  if (!user) return;
  renderLast();
  renderToday();
  if (view === 'trends') renderTrends();
}

function renderLast() {
  const list = visible();
  const last = list[list.length - 1];
  if (!last) {
    $('lastAgo').textContent = 'No bottles yet';
    $('lastDetail').textContent = '';
    return;
  }
  $('lastAgo').textContent = L.formatAgo(Date.now() - new Date(last.started_at));
  $('lastDetail').textContent = `${ozText(last)} · ${TYPE_NAME[last.bottle_type] ?? ''}`;
}

function renderToday() {
  const today = L.dayKey(new Date());
  const todays = visible().filter((b) => L.dayKey(new Date(b.started_at)) === today);
  const { count, oz } = L.totalsFor(todays);
  $('todayCount').textContent = `${count} bottle${count === 1 ? '' : 's'}`;
  $('todayOz').textContent = L.fmtOz(oz);
  const rows = [...todays].reverse().map((b) => `
    <button class="item" data-edit="${esc(b.id)}" type="button">
      <span>${L.formatTime(new Date(b.started_at))} <span class="dim">· ${esc(TYPE_NAME[b.bottle_type] ?? '')}</span></span>
      <span>${esc(ozText(b))}</span>
    </button>`);
  $('todayList').innerHTML = rows.length ? rows.join('') : '<div class="empty">No bottles logged today yet.</div>';
}

function renderTrends() {
  const today = L.dayKey(new Date());
  const { from, to, days } = L.periodRange(period, today);
  const list = visible();

  $('rangeLabel').textContent = `${fmtDay(from)} – ${fmtDay(to)}`;

  // Fl oz per day
  const daily = L.dailyTotals(list, from, to);
  const max = Math.max(0, ...daily.map((d) => d.oz));
  $('chart').innerHTML = daily.map((d) => {
    const h = max ? Math.round((d.oz / max) * 100) : 0;
    return `<div class="bar ${d.oz ? '' : 'zero'}" style="height:${d.oz ? Math.max(h, 4) : 3}px" title="${esc(fmtDay(d.day))}: ${esc(L.fmtOz(d.oz))}"></div>`;
  }).join('');
  $('chartLabels').innerHTML = daily.map((d, i) => {
    let label = '';
    if (period === 'week') label = new Date(`${d.day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'narrow' });
    else if (i % 5 === 0 || i === daily.length - 1) label = String(Number(d.day.slice(8)));
    return `<span>${esc(label)}</span>`;
  }).join('');
  const total = daily.reduce((s, d) => s + d.oz, 0);
  const count = daily.reduce((s, d) => s + d.count, 0);
  $('avgLine').textContent = `Average ${L.fmtOz(Math.round((total / days) * 100) / 100)} per day · ${count} bottles`;

  // Time of day
  const hours = L.hourlyCounts(list, from, to);
  const hmax = Math.max(0, ...hours);
  $('heat').innerHTML = hours.map((c, h) => {
    const label = `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
    return `<div class="cell l${L.intensity(c, hmax)}" title="${label}: ${c} bottle${c === 1 ? '' : 's'}">${label}<br>${c || ''}</div>`;
  }).join('');

  // Daily history (newest first)
  const rows = [...daily].reverse().map((d) => {
    const open = openDay === d.day;
    const detail = open
      ? `<div class="dayBody">${list.filter((b) => L.dayKey(new Date(b.started_at)) === d.day).reverse().map((b) => `
          <button class="item" data-edit="${esc(b.id)}" type="button">
            <span>${L.formatTime(new Date(b.started_at))}</span><span>${esc(ozText(b))}</span>
          </button>`).join('') || '<div class="empty">No bottles this day.</div>'}</div>`
      : '';
    return `
      <button class="day" data-day="${esc(d.day)}" type="button">
        <span>${esc(fmtDay(d.day))}</span>
        <span class="dim">${d.count ? `${d.count} bottle${d.count === 1 ? '' : 's'} · ${esc(L.fmtOz(d.oz))}` : 'No bottles'}</span>
      </button>${detail}`;
  });
  $('history').innerHTML = rows.join('');
}

function showScreen() {
  const signedIn = !!user;
  $('auth').classList.toggle('hidden', signedIn);
  $('app').classList.toggle('hidden', !signedIn);
  $('signout').classList.toggle('hidden', !signedIn);
  if (signedIn) render();
}

// ---------- add / edit sheet ----------
function setType(type) {
  document.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  $('singleAmt').classList.toggle('hidden', type === 'mixed');
  $('mixedAmt').classList.toggle('hidden', type !== 'mixed');
  sheet.type = type;
}

function openSheet(bottle) {
  const prefs = loadJson(PREFS_KEY, { type: 'formula', oz: 4 });
  $('formError').classList.add('hidden');
  if (bottle) {
    sheet = { mode: 'edit', id: bottle.id, type: bottle.bottle_type };
    $('sheetTitle').textContent = 'Edit bottle';
    $('deleteBtn').classList.remove('hidden');
    $('oz').value = bottle.total_oz ?? prefs.oz;
    $('bmOz').value = bottle.breast_milk_oz ?? 2;
    $('fmOz').value = bottle.formula_oz ?? 2;
    $('when').value = L.toLocalInput(new Date(bottle.started_at));
  } else {
    sheet = { mode: 'new', id: null, type: prefs.type };
    $('sheetTitle').textContent = 'Log bottle';
    $('deleteBtn').classList.add('hidden');
    $('oz').value = prefs.oz;
    $('bmOz').value = 2;
    $('fmOz').value = 2;
    $('when').value = L.toLocalInput(new Date());
  }
  setType(sheet.type === 'unknown' ? 'formula' : sheet.type);
  $('sheetWrap').classList.remove('hidden');
}

function closeSheet() {
  $('sheetWrap').classList.add('hidden');
  sheet = null;
}

function validate() {
  const type = sheet.type;
  let oz = null; let bm = null; let fm = null;
  if (type === 'mixed') {
    bm = parseFloat($('bmOz').value);
    fm = parseFloat($('fmOz').value);
    if (!(bm >= 0) || !(fm >= 0) || bm + fm <= 0) return { error: 'Enter breast milk and formula amounts (total above 0).' };
    if (bm > 32 || fm > 32) return { error: 'Amounts look too large. Check the numbers.' };
  } else {
    oz = parseFloat($('oz').value);
    if (!(oz > 0)) return { error: 'Enter an amount in fl oz.' };
    if (oz > 32) return { error: 'Amounts look too large. Check the number.' };
    if (L.roundToStep(oz) !== oz) return { error: 'Use quarter-ounce steps (for example 3.5 or 4.25).' };
  }
  const when = L.zonedToDate($('when').value);
  if (Number.isNaN(when.getTime())) return { error: 'Enter a valid time.' };
  if (when.getTime() > Date.now() + 60000) return { error: "The time can't be in the future." };
  const ounces = L.splitOunces(type, oz, bm, fm);
  return {
    fields: {
      started_at: when.toISOString(),
      local_day: L.dayKey(when),
      bottle_type: type,
      ...ounces,
    },
    prefs: { type, oz: oz ?? 4 },
  };
}

// ---------- undo ----------
function undoLast() {
  const mine = visible().filter((b) => b.source === 'app' || String(b.id).startsWith('tmp-'));
  if (!mine.length) { toast('Nothing to undo.'); return; }
  const last = mine.reduce((a, b) => ((a.created_at ?? '') >= (b.created_at ?? '') ? a : b));
  if (!confirm(`Undo the bottle at ${L.formatTime(new Date(last.started_at))}?`)) return;
  deleteBottle(last.id);
  toast('Bottle removed.');
}

// ---------- auth (email + password) ----------
async function signIn(e) {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = /confirm/i.test(error.message)
      ? 'Confirm your email first: tap the link in the confirmation email.'
      : 'Email or password not recognized.';
    toast(msg);
  }
}

async function createAccount() {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || password.length < 8) {
    toast('Enter your email and a password of at least 8 characters.');
    return;
  }
  const { error } = await sb.auth.signUp({ email, password });
  if (error) { toast(`Could not create account: ${error.message}`); return; }
  $('password').value = '';
  $('authNote').textContent = 'Account created. Tap the link in the confirmation email, then sign in here.';
}

// ---------- wiring ----------
function bind() {
  $('loginForm').addEventListener('submit', signIn);
  $('createBtn').addEventListener('click', createAccount);
  $('signout').addEventListener('click', async () => { await sb.auth.signOut(); });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    view = t.dataset.view;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $('viewToday').classList.toggle('hidden', view !== 'today');
    $('viewTrends').classList.toggle('hidden', view !== 'trends');
    render();
  }));

  document.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => {
    period = b.dataset.period;
    document.querySelectorAll('[data-period]').forEach((x) => x.classList.toggle('active', x === b));
    renderTrends();
  }));

  $('logBtn').addEventListener('click', () => openSheet(null));
  $('undoBtn').addEventListener('click', undoLast);

  // Tapping a bottle (today list or history) opens the editor.
  document.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const b = visible().find((x) => x.id === edit.dataset.edit);
      if (b) openSheet(b);
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) {
      openDay = openDay === day.dataset.day ? null : day.dataset.day;
      renderTrends();
    }
  });

  document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  document.querySelectorAll('.step').forEach((b) => b.addEventListener('click', () => {
    const v = Math.max(0, Math.min(32, (parseFloat($('oz').value) || 0) + parseFloat(b.dataset.step)));
    $('oz').value = L.roundToStep(v);
  }));
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetWrap').addEventListener('click', (e) => { if (e.target === $('sheetWrap')) closeSheet(); });

  $('bottleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sheet) return;
    const result = validate();
    if (result.error) {
      $('formError').textContent = result.error;
      $('formError').classList.remove('hidden');
      return;
    }
    if (sheet.mode === 'new') addBottle(result.fields);
    else updateBottle(sheet.id, result.fields);
    saveJson(PREFS_KEY, result.prefs);
    closeSheet();
    toast('Saved');
  });
  $('deleteBtn').addEventListener('click', () => {
    if (!sheet || sheet.mode !== 'edit') return;
    if (!confirm('Delete this bottle?')) return;
    deleteBottle(sheet.id);
    closeSheet();
    toast('Bottle deleted.');
  });

  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(() => { if (user) renderLast(); }, 30000);
  setInterval(() => { if (user && !document.hidden) sync(); }, 60000);
}

function startLiveUpdates() {
  if (started) return;
  started = true;
  // Live refresh when the other caregiver changes data (needs Realtime on the bottles table).
  sb.channel('bottles-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bottles' }, () => { if (!queue.length) sync(); })
    .subscribe();
}

async function start() {
  bind();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  const { data } = await sb.auth.getSession();
  user = data.session?.user ?? null;
  showScreen();
  if (user) { startLiveUpdates(); await sync(); }

  sb.auth.onAuthStateChange((_event, session) => {
    const was = user;
    user = session?.user ?? null;
    showScreen();
    if (user && !was) { startLiveUpdates(); sync(); }
  });
}

start();
