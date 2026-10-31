import { JKT48_API_KEY, JKT48_THEATER_URL, MEMBER_KEYWORDS, CACHE_MINUTES } from "./jkt48-config.js";

const root = document.getElementById("showSchedule");
const body = root && root.querySelector(".sched-body");
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const KEYS = MEMBER_KEYWORDS.map(norm);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const star = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l2.2 6.3 6.3.2-5 3.9 1.8 6.4L12 15l-5.3 3.8 1.8-6.4-5-3.9 6.3-.2z"/></svg>';

// Format API: array of { title, setlist, date:"YYYY-MM-DD", time:"HH:MM", venue, members:[...], is_upcoming }
const hasDena = (show) => {
  const m = Array.isArray(show.members) ? show.members : [];
  return m.some((name) => KEYS.some((k) => norm(name).includes(k)));
};
const toDate = (s) => new Date(`${s.date}T${/^\d{1,2}:\d{2}/.test(s.time || "") ? String(s.time).slice(0, 5).padStart(5, "0") : "00:00"}:00+07:00`);

function fmtDate(s) {
  const d = toDate(s);
  if (isNaN(d)) return s.date || "Jadwal belum tersedia";
  const tgl = d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
  return s.time ? `${tgl} • ${String(s.time).slice(0, 5)} WIB` : tgl;
}

async function api() {
  const url = `${JKT48_THEATER_URL}?apikey=${encodeURIComponent(JKT48_API_KEY)}`;
  let r;
  try { r = await fetch(url, { headers: { Accept: "application/json" } }); }
  catch (_) { throw new Error("NETWORK"); }
  if (!r.ok) {
    let d = "";
    try { const j = await r.json(); d = j.detail || j.error || ""; } catch (_) {}
    throw new Error("HTTP " + r.status + (d ? " — " + d : ""));
  }
  try { return await r.json(); } catch (_) { throw new Error("FORMAT"); }
}

async function loadShows() {
  const ck = "jkt48_dena_shows_v4";
  try {
    const c = JSON.parse(sessionStorage.getItem(ck) || "null");
    if (c && Date.now() - c.t < CACHE_MINUTES * 60000) return c.v;
  } catch (_) {}
  const data = await api();
  const list = Array.isArray(data) ? data : (data && (data.data || data.theater || data.shows));
  if (!Array.isArray(list)) throw new Error("FORMAT");
  const upcoming = list.filter((s) => s.is_upcoming !== false);
  upcoming.sort((a, b) => toDate(a) - toDate(b));
  const v = { shows: upcoming.filter(hasDena), total: upcoming.length };
  try { sessionStorage.setItem(ck, JSON.stringify({ t: Date.now(), v })); } catch (_) {}
  return v;
}

async function init() {
  if (!root) return;
  if (!JKT48_API_KEY || JKT48_API_KEY === "ISI_API_KEY_KAMU") {
    body.innerHTML = '<p class="sched-msg">API key belum diisi. Buka <code>jkt48-config.js</code> lalu isi <code>JKT48_API_KEY</code>.</p>';
    return;
  }
  try {
    const { shows, total } = await loadShows();
    if (!shows.length) {
      body.innerHTML = `<div class="sched-empty"><span class="sched-empty-ico">${star}</span><p><strong>Belum ada Dena</strong> di jadwal show mendatang.</p><small>${total} show mendatang dicek.</small></div>`;
      return;
    }
    body.innerHTML = shows.map((s) => `
      <article class="sched-item">
        <div class="sched-badge">${star}<span>Ada Dena!</span></div>
        <h4>${esc(s.setlist || s.title || "Show Theater JKT48")}</h4>
        ${s.setlist && s.title ? `<p class="sched-sub-title">${esc(s.title)}</p>` : ""}
        <p class="sched-date">${esc(fmtDate(s))}</p>
        ${s.venue ? `<p class="sched-venue">${esc(s.venue)}</p>` : ""}
      </article>`).join("") + `<small class="sched-foot">Menampilkan ${shows.length} dari ${total} show mendatang.</small>`;
  } catch (e) {
    console.warn("[Jadwal JKT48]", e);
    const why = {
      FORMAT: "format data dari API tidak dikenali",
      NETWORK: "tidak bisa terhubung ke API (koneksi atau CORS diblokir)",
      "HTTP 401": "API key ditolak (401)",
      "HTTP 403": "API key ditolak atau kuota habis (403)",
      "HTTP 404": "fungsi /api/theater belum aktif di hosting (folder api/ atau netlify/ belum ter-upload)",
      "HTTP 429": "kuota API habis (429), coba lagi nanti",
    }[e.message] || e.message;
    body.innerHTML = `<p class="sched-msg">Jadwal belum bisa dimuat: ${esc(why)}.<br /><small>Cek <code>jkt48-config.js</code> lalu muat ulang halaman.</small></p>`;
  }
}
init();
