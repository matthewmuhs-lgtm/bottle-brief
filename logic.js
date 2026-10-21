// Pure logic for Bottle Brief: day keys, totals, trends, time-ago text.
// No browser or network code here, so it can be tested in Node.

export const TZ = 'America/Detroit';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const hourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour: 'numeric', hourCycle: 'h23',
});
const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
});

// 'YYYY-MM-DD' for a Date, in household time (midnight Eastern boundary).
export function dayKey(date) {
  return dayFmt.format(date); // en-CA gives YYYY-MM-DD
}

export function hourOf(date) {
  return Number(hourFmt.format(date)) % 24;
}

export function formatTime(date) {
  return timeFmt.format(date).toLowerCase();
}

// Shifts a 'YYYY-MM-DD' key by n days (n may be negative).
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + n);
  return new Date(t).toISOString().slice(0, 10);
}

// Inclusive date range for a trend period, ending today.
export function periodRange(period, todayKey) {
  const days = period === 'month' ? 30 : 7;
  return { from: addDays(todayKey, -(days - 1)), to: todayKey, days };
}

// Human "time since" text: "2h 14m ago", "45m ago", "just now".
export function formatAgo(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m ago`;
  return `${h}h ${String(m).padStart(2, '0')}m ago`;
}

// Bottles are objects shaped like the Supabase rows:
// { started_at (ISO), total_oz (number|null), bottle_type, ... }
// Bottles with no amount count as bottles but add nothing to fl oz.
export function totalsFor(bottles) {
  let count = 0;
  let oz = 0;
  for (const b of bottles) {
    count += 1;
    if (b.total_oz != null) oz += Number(b.total_oz);
  }
  return { count, oz: Math.round(oz * 100) / 100 };
}

// Groups bottles by household day key.
export function groupByDay(bottles) {
  const map = new Map();
  for (const b of bottles) {
    const k = dayKey(new Date(b.started_at));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(b);
  }
  return map;
}

// One row per day across [from, to], including empty days with zero totals.
export function dailyTotals(bottles, from, to) {
  const groups = groupByDay(bottles);
  const rows = [];
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const list = groups.get(k) || [];
    rows.push({ day: k, ...totalsFor(list) });
  }
  return rows;
}

// Bottle counts per hour of day (0-23) across the given day range.
export function hourlyCounts(bottles, from, to) {
  const counts = new Array(24).fill(0);
  for (const b of bottles) {
    const d = new Date(b.started_at);
    const k = dayKey(d);
    if (k < from || k > to) continue;
    counts[hourOf(d)] += 1;
  }
  return counts;
}

// Maps a count to a 0..4 intensity level for shading.
export function intensity(count, max) {
  if (count === 0 || max === 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

// Splits an entry into per-type ounces. Mixed needs both amounts.
export function splitOunces(type, oz, breastOz, formulaOz) {
  if (type === 'breast_milk') return { breast_milk_oz: oz, formula_oz: null, total_oz: oz };
  if (type === 'formula') return { breast_milk_oz: null, formula_oz: oz, total_oz: oz };
  if (type === 'mixed') {
    const total = Math.round((breastOz + formulaOz) * 100) / 100;
    return { breast_milk_oz: breastOz, formula_oz: formulaOz, total_oz: total };
  }
  return { breast_milk_oz: null, formula_oz: null, total_oz: null };
}

// Offset (ms) of TZ from UTC at the given instant.
function tzOffsetMs(ts) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ts)).map(x => [x.type, x.value])
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

// Converts 'YYYY-MM-DDTHH:MM' (household wall-clock time) to a Date.
export function zonedToDate(local) {
  const [date, time] = local.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return new Date(guess - tzOffsetMs(guess));
}

// Inverse: a Date to 'YYYY-MM-DDTHH:MM' in household time, for form inputs.
export function toLocalInput(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).formatToParts(date).map(x => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// '22.5 fl oz', '4 fl oz', '4.25 fl oz'.
export function fmtOz(n) {
  return `${Number(Number(n).toFixed(2))} fl oz`;
}

export const OZ_STEP = 0.25;
export function roundToStep(n) {
  return Math.round(n / OZ_STEP) * OZ_STEP;
}
