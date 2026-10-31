import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  deleteDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";

// ===== Pengaturan =====
const PER_PAGE = 30; // 1 halaman = 30 pesan (5 kolom laptop, 3 kolom tablet, 2 kolom HP)

// ===== Firebase =====
const configured = !String(firebaseConfig.apiKey || "").startsWith("GANTI");
let auth = null;
let db = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// ===== State =====
let messages = []; // terbaru di indeks 0
let currentPage = 1;
let isAdmin = false;
let openedMessage = null;

const $ = (id) => document.getElementById(id);
const grid = $("msgGrid");
const pagination = $("msgPagination");
const countEl = $("allMessagesCount");
const detailPopup = $("msgDetailPopup");

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ===== Menu mobile =====
const menuToggle = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");
if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    menuToggle.classList.toggle("open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
  });
}

// ===== Render =====
function totalPages() {
  return Math.max(1, Math.ceil(messages.length / PER_PAGE));
}

// Batas karakter teks di kartu (teks lengkap tampil di popup detail)
const CARD_PREVIEW_CHARS = 70;

function previewText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const short =
    clean.length > CARD_PREVIEW_CHARS
      ? clean.slice(0, CARD_PREVIEW_CHARS).trimEnd() + "…"
      : clean;
  return "\u201C" + short + "\u201D";
}

function makeHeartIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const wrap = document.createElement("span");
  wrap.className = "msg-card-heart";
  wrap.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", "#i-heart");
  svg.appendChild(use);
  wrap.appendChild(svg);
  return wrap;
}

function makeCard(message) {
  const name = message.name || "Anonim";

  const card = document.createElement("button");
  card.type = "button";
  card.className = "msg-card";
  card.setAttribute("aria-label", "Buka pesan dari " + name);

  const head = document.createElement("div");
  head.className = "msg-card-head";
  const avatar = document.createElement("span");
  avatar.className = "msg-card-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = name.charAt(0).toUpperCase();

  const meta = document.createElement("div");
  meta.className = "msg-card-meta";
  const nameEl = document.createElement("span");
  nameEl.className = "msg-card-name";
  nameEl.textContent = name;
  const date = document.createElement("span");
  date.className = "msg-card-date";
  date.textContent = formatDate(message.date);
  meta.append(nameEl, date);

  head.append(avatar, meta);

  const text = document.createElement("p");
  text.className = "msg-card-text";
  text.textContent = previewText(message.message);

  card.append(head, text, makeHeartIcon());
  card.addEventListener("click", () => openDetail(message));
  return card;
}

function renderGrid() {
  grid.innerHTML = "";

  if (messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "all-messages-empty";
    empty.textContent = configured ? "Belum ada pesan." : "Firebase belum dikonfigurasi.";
    grid.appendChild(empty);
    return;
  }

  const start = (currentPage - 1) * PER_PAGE;
  messages.slice(start, start + PER_PAGE).forEach((m) => grid.appendChild(makeCard(m)));
}

function pageButton(label, page, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "msg-page-btn" + (opts.active ? " active" : "");
  btn.textContent = label;
  btn.disabled = !!opts.disabled;
  if (opts.aria) btn.setAttribute("aria-label", opts.aria);
  if (opts.active) btn.setAttribute("aria-current", "page");
  btn.addEventListener("click", () => goToPage(page));
  return btn;
}

function renderPagination() {
  pagination.innerHTML = "";
  const total = totalPages();
  if (total <= 1) return;

  pagination.appendChild(
    pageButton("‹", currentPage - 1, { disabled: currentPage === 1, aria: "Halaman sebelumnya" })
  );

  // Halaman pertama, terakhir, dan sekitar halaman aktif
  const pages = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - currentPage) <= 1) pages.push(p);
  }
  let prev = 0;
  pages.forEach((p) => {
    if (p - prev > 1) {
      const gap = document.createElement("span");
      gap.className = "msg-page-gap";
      gap.textContent = "…";
      pagination.appendChild(gap);
    }
    pagination.appendChild(pageButton(String(p), p, { active: p === currentPage }));
    prev = p;
  });

  pagination.appendChild(
    pageButton("›", currentPage + 1, { disabled: currentPage === total, aria: "Halaman berikutnya" })
  );
}

function render() {
  currentPage = Math.min(Math.max(1, currentPage), totalPages());
  if (countEl) {
    countEl.textContent = messages.length
      ? messages.length + " pesan · Halaman " + currentPage + " dari " + totalPages()
      : "";
  }
  renderGrid();
  renderPagination();
}

function goToPage(page) {
  currentPage = page;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ===== Detail pesan =====
function openDetail(message) {
  openedMessage = message;
  $("msgDetailName").textContent = message.name || "Anonim";
  $("msgDetailDate").textContent = formatDate(message.date);
  $("msgDetailText").textContent = message.message;
  $("msgDetailAdmin").hidden = !isAdmin;
  detailPopup.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDetail() {
  detailPopup.hidden = true;
  document.body.style.overflow = "";
  openedMessage = null;
}

$("msgDetailClose").addEventListener("click", closeDetail);
detailPopup.addEventListener("click", (e) => {
  if (e.target === detailPopup) closeDetail();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !detailPopup.hidden) closeDetail();
});

$("msgDetailEdit").addEventListener("click", async () => {
  if (!isAdmin || !openedMessage) return;
  const next = prompt("Edit pesan:", openedMessage.message || "");
  if (next === null) return;
  const trimmed = next.trim().slice(0, 200);
  if (!trimmed) return;
  try {
    await updateDoc(doc(db, "messages", openedMessage.id), { message: trimmed });
    closeDetail();
  } catch (err) {
    alert("Gagal mengedit: " + err.message);
  }
});

$("msgDetailDelete").addEventListener("click", async () => {
  if (!isAdmin || !openedMessage) return;
  if (!confirm("Hapus pesan ini?")) return;
  try {
    await deleteDoc(doc(db, "messages", openedMessage.id));
    closeDetail();
  } catch (err) {
    alert("Gagal menghapus: " + err.message);
  }
});

// ===== Admin (login dilakukan di halaman utama lewat #admin) =====
if (auth) {
  onAuthStateChanged(auth, (user) => {
    const email = ((user && user.email) || "").toLowerCase();
    isAdmin = !!(
      user &&
      user.emailVerified &&
      ADMIN_EMAILS.some((e) => e.toLowerCase() === email)
    );
  });
}

// ===== Muat semua pesan (realtime, terbaru di halaman 1) =====
function loadMessages() {
  if (!db) {
    render();
    return;
  }
  const q = query(collection(db, "messages"), orderBy("createdAt", "desc"));
  onSnapshot(
    q,
    (snap) => {
      messages = snap.docs.map((d) => {
        const x = d.data();
        const t = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate() : new Date();
        return {
          id: d.id,
          name: String(x.name || ""),
          message: String(x.message || ""),
          date: t.toISOString(),
        };
      });
      render();
    },
    (err) => {
      console.warn("Gagal memuat pesan:", err.message);
      render();
    }
  );
}

loadMessages();
