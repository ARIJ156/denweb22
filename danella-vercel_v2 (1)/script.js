import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAILS } from "./firebase-config.js";

// ===== Firebase init =====
const configured = !String(firebaseConfig.apiKey || "").startsWith("GANTI");
let auth = null;
let db = null;

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} else {
  console.warn("Firebase belum dikonfigurasi. Isi firebase-config.js.");
}

// ===== State =====
let currentUser = null;
let isAdmin = false;
let galleryCache = []; // dari Firestore (manual)
let messagesCache = [];
let editingGalleryId = null;

const $ = (id) => document.getElementById(id);

function setMsg(el, text, isInfo) {
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.classList.toggle("info", !!isInfo);
  el.hidden = false;
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

// ===== Mobile menu =====
const menuToggle = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");

if (menuToggle && navLinks) {
  menuToggle.addEventListener("click", () => {
    const open = navLinks.classList.toggle("open");
    menuToggle.classList.toggle("open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.classList.remove("open");
      menuToggle.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

// ===== Auth UI =====
const adminChip = $("adminChip");
const addFotoBtn = $("addFotoBtn");
const adminPopup = $("adminPopup");
const adminCancelBtn = $("adminCancelBtn");
const adminMsg = $("adminMsg");
const adminLoginBtn = $("adminLoginBtn");
const loginBtn = $("loginBtn");
const logoutBtn = $("logoutBtn");
const authText = $("authText");
const messageForm = $("messageForm");

function openAdminPopup() {
  if (!adminPopup) return;
  setMsg(adminMsg, "");
  adminPopup.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeAdminPopup() {
  if (!adminPopup) return;
  adminPopup.hidden = true;
  document.body.style.overflow = "";
}

async function login() {
  if (!configured) {
    const text = "Firebase belum dikonfigurasi (isi firebase-config.js).";
    setMsg(adminMsg, text);
    alert(text);
    return;
  }
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (
      err.code === "auth/popup-closed-by-user" ||
      err.code === "auth/cancelled-popup-request"
    ) {
      return;
    }
    let text = "Gagal masuk: " + (err.message || err.code);
    if (err.code === "auth/unauthorized-domain") {
      text =
        "Domain ini belum diizinkan. Tambahkan di Firebase Console → Authentication → Settings → Authorized domains.";
    }
    setMsg(adminMsg, text);
    alert(text);
  }
}

async function logout() {
  if (auth) await fbSignOut(auth);
}

// ===== Popup verifikasi email (otomatis saat website dibuka) =====
const authPopup = $("authPopup");
const authPopupDesc = $("authPopupDesc");
const authPopupMsg = $("authPopupMsg");
const authGoogleBtn = $("authGoogleBtn");
const authGuestBtn = $("authGuestBtn");
const authEmailForm = $("authEmailForm");
const authEmail = $("authEmail");
const authEmailSubmit = $("authEmailSubmit");

const EMAIL_KEY = "denalizeEmailForSignIn";
const DESC_DEFAULT =
  "Verifikasi email kamu dengan Google atau lewat link yang dikirim ke emailmu. Atau lanjut sebagai tamu untuk melihat-lihat.";
const DESC_NEED_LOGIN = "Login agar kamu bisa mengirim pesan untuk Danella";

function canSendMessage() {
  return !!(currentUser && currentUser.emailVerified);
}

function openAuthPopup(needLogin) {
  if (!authPopup || canSendMessage()) return;
  setMsg(authPopupMsg, "");
  if (authPopupDesc) authPopupDesc.textContent = needLogin ? DESC_NEED_LOGIN : DESC_DEFAULT;
  authPopup.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeAuthPopup() {
  if (!authPopup) return;
  authPopup.hidden = true;
  if (!(adminPopup && !adminPopup.hidden)) document.body.style.overflow = "";
}

function authErrorText(err) {
  switch (err && err.code) {
    case "auth/unauthorized-domain":
    case "auth/unauthorized-continue-uri":
    case "auth/invalid-continue-uri":
      return "Domain ini belum diizinkan. Tambahkan di Firebase Console → Authentication → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      return "Metode ini belum diaktifkan di Firebase Console → Authentication → Sign-in method.";
    case "auth/invalid-email":
      return "Format email tidak valid.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "Link verifikasi tidak valid atau sudah kedaluwarsa. Kirim ulang link yang baru.";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan. Coba lagi beberapa saat.";
    case "auth/network-request-failed":
      return "Koneksi internet bermasalah.";
    default:
      return "Gagal: " + ((err && (err.message || err.code)) || "tidak diketahui");
  }
}

async function verifyWithGoogle() {
  if (!configured) {
    setMsg(authPopupMsg, "Firebase belum dikonfigurasi (isi firebase-config.js).");
    return;
  }
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (
      err.code === "auth/popup-closed-by-user" ||
      err.code === "auth/cancelled-popup-request"
    ) {
      return;
    }
    setMsg(authPopupMsg, authErrorText(err));
  }
}

async function sendVerificationLink(e) {
  e.preventDefault();
  if (!configured) {
    setMsg(authPopupMsg, "Firebase belum dikonfigurasi (isi firebase-config.js).");
    return;
  }
  const email = authEmail.value.trim();
  if (!email) {
    setMsg(authPopupMsg, "Masukkan email kamu dulu.");
    return;
  }

  authEmailSubmit.disabled = true;
  setMsg(authPopupMsg, "");
  try {
    await sendSignInLinkToEmail(auth, email, {
      url: location.origin + location.pathname,
      handleCodeInApp: true,
    });
    try {
      localStorage.setItem(EMAIL_KEY, email);
    } catch {
      /* penyimpanan diblokir: email ditanya lagi saat link dibuka */
    }
    authEmailSubmit.textContent = "Kirim Ulang Link";
    setMsg(
      authPopupMsg,
      "Link verifikasi dikirim ke " + email + ". Buka email (cek juga folder spam) lalu klik link-nya.",
      true
    );
  } catch (err) {
    setMsg(authPopupMsg, authErrorText(err));
  } finally {
    authEmailSubmit.disabled = false;
  }
}

// Dipanggil saat halaman dibuka dari link di email
async function completeEmailLinkVerification() {
  if (!auth || !isSignInWithEmailLink(auth, location.href)) return;

  let email = "";
  try {
    email = localStorage.getItem(EMAIL_KEY) || "";
  } catch {
    /* abaikan */
  }
  if (!email) {
    email = (prompt("Masukkan email yang kamu gunakan untuk verifikasi:") || "").trim();
  }
  if (!email) return;

  try {
    await signInWithEmailLink(auth, email, location.href);
    try {
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* abaikan */
    }
    history.replaceState(null, "", location.pathname + "#dear");
    alert("Email berhasil diverifikasi. Sekarang kamu bisa mengirim pesan.");
  } catch (err) {
    history.replaceState(null, "", location.pathname + location.hash);
    alert(authErrorText(err));
  }
}

if (authGoogleBtn) authGoogleBtn.addEventListener("click", verifyWithGoogle);
if (authGuestBtn) authGuestBtn.addEventListener("click", closeAuthPopup);
if (authEmailForm) authEmailForm.addEventListener("submit", sendVerificationLink);
if (authPopup) {
  authPopup.addEventListener("click", (e) => {
    if (e.target === authPopup) closeAuthPopup();
  });
}

function updateAuthUI() {
  const loggedIn = !!currentUser;

  if (loginBtn) loginBtn.hidden = loggedIn;
  if (logoutBtn) logoutBtn.hidden = !loggedIn;

  if (authText) {
    authText.textContent = loggedIn
      ? "Masuk sebagai " + (currentUser.email || currentUser.displayName)
      : "Kamu masuk sebagai tamu. Verifikasi email untuk mengirim pesan.";
  }

  if (messageForm) {
    messageForm.classList.toggle("locked", !canSendMessage());

    const nameInput = $("senderName");
    if (canSendMessage() && nameInput && !nameInput.value && currentUser.displayName) {
      nameInput.value = currentUser.displayName.split(" ")[0].slice(0, 20);
    }
  }

  isAdmin = false;
  if (loggedIn) {
    const email = (currentUser.email || "").toLowerCase();
    isAdmin =
      currentUser.emailVerified &&
      ADMIN_EMAILS.some((e) => e.toLowerCase() === email);
  }

  document.body.classList.toggle("admin-mode", isAdmin);
  if (addFotoBtn) addFotoBtn.hidden = !isAdmin;
  if (adminChip) {
    adminChip.hidden = !isAdmin;
    adminChip.textContent = isAdmin ? currentUser.email + " · Keluar" : "";
  }
}

let authFirstCheck = true;
const arrivingViaEmailLink = !!(auth && isSignInWithEmailLink(auth, location.href));

if (auth) {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    updateAuthUI();
    renderMessages();
    renderGallery();

    // Popup verifikasi otomatis terbuka saat website diakses
    if (canSendMessage()) {
      closeAuthPopup();
    } else if (authFirstCheck && !arrivingViaEmailLink && location.hash !== "#admin") {
      openAuthPopup(false);
    }
    authFirstCheck = false;

    if (adminPopup && !adminPopup.hidden && user) {
      if (isAdmin) {
        closeAdminPopup();
        if (location.hash === "#admin") {
          history.replaceState(null, "", location.pathname + location.search);
        }
      } else {
        setMsg(adminMsg, "Akun ini tidak terdaftar sebagai admin.");
      }
    }
  });
} else {
  updateAuthUI();
}

completeEmailLinkVerification();

if (loginBtn) loginBtn.addEventListener("click", login);
if (adminLoginBtn) adminLoginBtn.addEventListener("click", login);
if (logoutBtn) logoutBtn.addEventListener("click", logout);
if (adminChip) adminChip.addEventListener("click", logout);
if (adminCancelBtn) adminCancelBtn.addEventListener("click", closeAdminPopup);
if (adminPopup) {
  adminPopup.addEventListener("click", (e) => {
    if (e.target === adminPopup) closeAdminPopup();
  });
}

function checkAdminHash() {
  if (location.hash === "#admin" && !isAdmin) openAdminPopup();
}
window.addEventListener("hashchange", checkAdminHash);
checkAdminHash();

// ===== Galeri =====
const filterBtns = document.querySelectorAll(".filter-btn");
const karyaGrid = $("karyaGrid");

const CATEGORY_LABEL = {
  potret: "Album",
  identitas: "Danella & GEN 11",
  project: "Project",
};

function applyKaryaFilter() {
  const active = document.querySelector(".filter-btn.active");
  const filter = active ? active.dataset.filter : "all";
  let visible = 0;

  document.querySelectorAll(".karya-card").forEach((card) => {
    const show = filter === "all" || card.dataset.category === filter;
    card.classList.toggle("hidden", !show);
    if (show) visible++;
  });

  const empty = $("karyaEmpty");
  if (empty) empty.hidden = visible > 0;
}

filterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    applyKaryaFilter();
  });
});

function makeCard(item) {
  const article = document.createElement("article");
  article.className = "karya-card";
  article.dataset.category = item.category;

  const link = safeUrl(item.link);
  if (link) {
    article.classList.add("is-link");
    article.tabIndex = 0;
    article.setAttribute("role", "link");
    article.setAttribute("aria-label", "Buka postingan: " + (item.title || ""));
    const open = () => window.open(link, "_blank", "noopener,noreferrer");
    article.addEventListener("click", open);
    article.addEventListener("keydown", (e) => {
      if (e.key === "Enter") open();
    });
  }

  if (item.source === "firestore" && isAdmin) {
    const actions = document.createElement("div");
    actions.className = "karya-admin-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "karya-edit";
    edit.textContent = "✎";
    edit.title = "Edit foto";
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      showFotoPopup(item);
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "karya-delete";
    del.textContent = "×";
    del.title = "Hapus foto";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Hapus foto ini dari galeri?")) return;
      try {
        await deleteDoc(doc(db, "gallery", item.id));
      } catch (err) {
        alert("Gagal menghapus: " + err.message);
      }
    });

    actions.append(edit, del);
    article.appendChild(actions);
  }

  const thumb = document.createElement("div");
  thumb.className = "karya-thumb";
  if (item.image) {
    thumb.classList.add("has-image");
    thumb.style.backgroundImage = `url("${item.image.replace(/"/g, "%22")}")`;
  } else {
    thumb.style.background = "linear-gradient(145deg, #5eb7a8, #3a8f82)";
  }

  const tag = document.createElement("span");
  tag.className = "karya-tag";
  tag.textContent = CATEGORY_LABEL[item.category] || item.category;

  const overlay = document.createElement("span");
  overlay.className = "karya-title-overlay";
  overlay.textContent = link ? "LIHAT" : "FOTO";

  thumb.append(tag, overlay);

  const info = document.createElement("div");
  info.className = "karya-info";
  const h3 = document.createElement("h3");
  h3.textContent = item.title || "Tanpa judul";
  const p = document.createElement("p");
  p.textContent = item.desc || "";
  info.append(h3, p);

  article.append(thumb, info);
  return article;
}

function renderGallery() {
  if (!karyaGrid) return;
  karyaGrid.innerHTML = "";

  const items = galleryCache;
  items.forEach((item) => karyaGrid.appendChild(makeCard(item)));

  const empty = document.createElement("p");
  empty.className = "karya-empty";
  empty.id = "karyaEmpty";
  empty.textContent = "Belum ada foto.";
  empty.hidden = true;
  karyaGrid.appendChild(empty);

  applyKaryaFilter();
}

function loadGallery() {
  if (!db) {
    renderGallery();
    return;
  }
  const q = query(collection(db, "gallery"), orderBy("createdAt", "desc"), limit(60));
  onSnapshot(
    q,
    (snap) => {
      galleryCache = snap.docs.map((d) => ({
        id: d.id,
        source: "firestore",
        ...d.data(),
      }));
      renderGallery();
    },
    (err) => console.warn("Gagal memuat galeri:", err.message)
  );
}

// ===== Tambah / edit foto (admin) =====
const fotoPopup = $("fotoPopup");
const fotoForm = $("fotoForm");
const fotoCancelBtn = $("fotoCancelBtn");
const fotoFile = $("fotoFile");
const fotoFileLabel = $("fotoFileLabel");
const fotoPreviewWrap = $("fotoPreviewWrap");
const fotoPreview = $("fotoPreview");
const fotoError = $("fotoError");
const fotoSubmitBtn = $("fotoSubmitBtn");
const fotoPopupTitle = $("fotoPopupTitle");

const FILE_LABEL = "Pilih gambar (otomatis dikecilkan)";

function resetFotoForm() {
  if (fotoForm) fotoForm.reset();
  if (fotoFileLabel) fotoFileLabel.textContent = FILE_LABEL;
  if (fotoPreviewWrap) fotoPreviewWrap.hidden = true;
  if (fotoPreview) {
    if (fotoPreview.src.startsWith("blob:")) URL.revokeObjectURL(fotoPreview.src);
    fotoPreview.removeAttribute("src");
  }
  setMsg(fotoError, "");
}

function showFotoPopup(item) {
  if (!fotoPopup || !isAdmin) return;
  resetFotoForm();
  editingGalleryId = item ? item.id : null;

  if (fotoPopupTitle) {
    fotoPopupTitle.textContent = item ? "Edit Foto Galeri" : "Tambah Foto Galeri";
  }
  if (fotoSubmitBtn) fotoSubmitBtn.textContent = item ? "Simpan Perubahan" : "Simpan Foto";

  if (item) {
    $("fotoTitle").value = item.title || "";
    $("fotoDesc").value = item.desc || "";
    $("fotoCategory").value = item.category || "potret";
    $("fotoLink").value = item.link || "";
    if (item.image && fotoPreview) {
      fotoPreview.src = item.image;
      fotoPreviewWrap.hidden = false;
    }
    if (fotoFileLabel) fotoFileLabel.textContent = "Ganti gambar (opsional)";
  }

  fotoPopup.hidden = false;
  document.body.style.overflow = "hidden";
}

function hideFotoPopup() {
  if (!fotoPopup) return;
  fotoPopup.hidden = true;
  document.body.style.overflow = "";
  editingGalleryId = null;
}

function compressImage(file, maxSide = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);

      let q = quality;
      let out = canvas.toDataURL("image/jpeg", q);
      while (out.length > 900000 && q > 0.4) {
        q -= 0.1;
        out = canvas.toDataURL("image/jpeg", q);
      }
      if (out.length > 900000) {
        reject(new Error("Gambar terlalu besar, gunakan gambar yang lebih kecil."));
      } else {
        resolve(out);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Gagal membaca gambar."));
    };
    img.src = url;
  });
}

if (addFotoBtn) addFotoBtn.addEventListener("click", () => showFotoPopup(null));
if (fotoCancelBtn) fotoCancelBtn.addEventListener("click", hideFotoPopup);
if (fotoPopup) {
  fotoPopup.addEventListener("click", (e) => {
    if (e.target === fotoPopup) hideFotoPopup();
  });
}

if (fotoFile) {
  fotoFile.addEventListener("change", () => {
    const file = fotoFile.files && fotoFile.files[0];
    setMsg(fotoError, "");
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      fotoFile.value = "";
      setMsg(fotoError, "File harus berupa gambar.");
      return;
    }

    if (fotoFileLabel) fotoFileLabel.textContent = file.name;
    if (fotoPreview) {
      if (fotoPreview.src.startsWith("blob:")) URL.revokeObjectURL(fotoPreview.src);
      fotoPreview.src = URL.createObjectURL(file);
    }
    if (fotoPreviewWrap) fotoPreviewWrap.hidden = false;
  });
}

if (fotoForm) {
  fotoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    setMsg(fotoError, "");

    const title = $("fotoTitle").value.trim();
    const desc = $("fotoDesc").value.trim();
    const category = $("fotoCategory").value;
    const linkRaw = $("fotoLink").value.trim();
    const link = linkRaw ? safeUrl(linkRaw) : "";
    const file = fotoFile.files && fotoFile.files[0];

    if (!title || !desc || !category) {
      setMsg(fotoError, "Judul, deskripsi, dan kategori wajib diisi.");
      return;
    }
    if (linkRaw && !link) {
      setMsg(fotoError, "Link postingan tidak valid (harus diawali https://).");
      return;
    }
    if (!editingGalleryId && !file) {
      setMsg(fotoError, "Pilih gambar terlebih dahulu.");
      return;
    }

    fotoSubmitBtn.disabled = true;
    const label = fotoSubmitBtn.textContent;
    fotoSubmitBtn.textContent = "Menyimpan…";

    try {
      const data = { title, desc, category, link };
      if (file) data.image = await compressImage(file);

      if (editingGalleryId) {
        await updateDoc(doc(db, "gallery", editingGalleryId), data);
      } else {
        await addDoc(collection(db, "gallery"), {
          ...data,
          createdAt: serverTimestamp(),
        });
      }
      hideFotoPopup();
    } catch (err) {
      setMsg(fotoError, err.message || "Gagal menyimpan foto.");
    } finally {
      fotoSubmitBtn.disabled = false;
      fotoSubmitBtn.textContent = label;
    }
  });
}

// ===== Pesan dari fans + slider =====
const messagesList = $("messagesList");
const messagesEmpty = $("messagesEmpty");
const messagesDots = $("messagesDots");
const msgPrev = $("msgPrev");
const msgNext = $("msgNext");
const successPopup = $("successPopup");
const popupOkBtn = $("popupOkBtn");

const PER_SLIDE = 1;
const MAX_DASHBOARD_MESSAGES = 10; // pesan lama bergeser keluar jika ada pesan baru
const AUTO_MS = 4000;
let currentSlide = 0;
let totalSlides = 0;
let autoTimer = null;

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

function stopAuto() {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}

function startAuto() {
  stopAuto();
  if (totalSlides <= 1) return;
  autoTimer = setInterval(() => goToSlide(currentSlide + 1), AUTO_MS);
}

function goToSlide(index) {
  if (!messagesList || totalSlides === 0) return;
  currentSlide = ((index % totalSlides) + totalSlides) % totalSlides;

  messagesList.querySelectorAll(".messages-slide").forEach((slide, i) => {
    const active = i === currentSlide;
    slide.classList.toggle("active", active);
    slide.classList.remove("slide-in-right");
    if (active) {
      void slide.offsetWidth;
      slide.classList.add("slide-in-right");
    }
  });

  if (messagesDots) {
    messagesDots.querySelectorAll(".messages-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === currentSlide);
    });
  }

  if (msgPrev) msgPrev.disabled = totalSlides <= 1;
  if (msgNext) msgNext.disabled = totalSlides <= 1;
}

function makeMessageItem(message) {
  const senderName = message.name || "Anonim";

  const item = document.createElement("div");
  item.className = "message-item";

  const header = document.createElement("div");
  header.className = "message-item-header";

  const avatar = document.createElement("span");
  avatar.className = "message-item-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = senderName.charAt(0).toUpperCase();

  const meta = document.createElement("div");
  meta.className = "message-item-meta";
  const nameEl = document.createElement("span");
  nameEl.className = "message-item-name";
  nameEl.textContent = senderName;
  const dateEl = document.createElement("span");
  dateEl.className = "message-item-date";
  dateEl.textContent = formatDate(message.date);
  meta.append(nameEl, dateEl);

  header.append(avatar, meta);

  const text = document.createElement("p");
  text.className = "message-item-text";
  text.textContent = message.message || "";

  item.append(header, text);

  if (isAdmin && message.id) {
    const actions = document.createElement("div");
    actions.className = "message-admin-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", async () => {
      stopAuto();
      const next = prompt("Edit pesan:", message.message || "");
      if (next === null) return startAuto();
      const trimmed = next.trim().slice(0, 200);
      if (!trimmed) return startAuto();
      try {
        await updateDoc(doc(db, "messages", message.id), { message: trimmed });
      } catch (err) {
        alert("Gagal mengedit: " + err.message);
      }
      startAuto();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Hapus";
    del.addEventListener("click", async () => {
      if (!confirm("Hapus pesan ini?")) return;
      try {
        await deleteDoc(doc(db, "messages", message.id));
      } catch (err) {
        alert("Gagal menghapus: " + err.message);
      }
    });

    actions.append(edit, del);
    item.appendChild(actions);
  }

  return item;
}

function renderMessages() {
  if (!messagesList) return;

  messagesList.querySelectorAll(".messages-slide").forEach((s) => s.remove());
  if (messagesDots) messagesDots.innerHTML = "";

  if (messagesCache.length === 0) {
    if (messagesEmpty) messagesEmpty.hidden = false;
    totalSlides = 0;
    currentSlide = 0;
    if (msgPrev) msgPrev.disabled = true;
    if (msgNext) msgNext.disabled = true;
    stopAuto();
    return;
  }

  if (messagesEmpty) messagesEmpty.hidden = true;

  totalSlides = Math.ceil(messagesCache.length / PER_SLIDE);
  currentSlide = Math.min(currentSlide, Math.max(0, totalSlides - 1));

  for (let i = 0; i < totalSlides; i++) {
    const slide = document.createElement("div");
    slide.className = "messages-slide" + (i === currentSlide ? " active" : "");
    slide.appendChild(makeMessageItem(messagesCache[i]));
    messagesList.appendChild(slide);
  }

  if (messagesDots && totalSlides > 1) {
    for (let i = 0; i < totalSlides; i++) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "messages-dot" + (i === currentSlide ? " active" : "");
      dot.setAttribute("aria-label", "Pesan ke-" + (i + 1));
      dot.addEventListener("click", () => {
        goToSlide(i);
        startAuto();
      });
      messagesDots.appendChild(dot);
    }
  }

  goToSlide(currentSlide);
  startAuto();
}

function loadMessages() {
  if (!db) {
    renderMessages();
    return;
  }
  const q = query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(MAX_DASHBOARD_MESSAGES));
  onSnapshot(
    q,
    (snap) => {
      messagesCache = snap.docs.map((d) => {
        const x = d.data();
        const t = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate() : new Date();
        return {
          id: d.id,
          name: String(x.name || ""),
          message: String(x.message || ""),
          date: t.toISOString(),
        };
      });
      renderMessages();
    },
    (err) => console.warn("Gagal memuat pesan:", err.message)
  );
}

function showPopup() {
  if (!successPopup) return;
  successPopup.hidden = false;
  document.body.style.overflow = "hidden";
}

function hidePopup() {
  if (!successPopup) return;
  successPopup.hidden = true;
  document.body.style.overflow = "";
}

if (msgPrev) {
  msgPrev.addEventListener("click", () => {
    goToSlide(currentSlide - 1);
    startAuto();
  });
}
if (msgNext) {
  msgNext.addEventListener("click", () => {
    goToSlide(currentSlide + 1);
    startAuto();
  });
}

const listBox = document.querySelector(".messages-list-box");
if (listBox) {
  listBox.addEventListener("mouseenter", stopAuto);
  listBox.addEventListener("mouseleave", startAuto);

  if ("IntersectionObserver" in window) {
    let wasVisible = false;
    new IntersectionObserver(
      (entries) => {
        const visible = entries[0].isIntersecting;
        if (visible && !wasVisible && totalSlides > 0) {
          goToSlide(0);
          startAuto();
        } else if (!visible) {
          stopAuto();
        }
        wasVisible = visible;
      },
      { threshold: 0.4 }
    ).observe(listBox);
  }
}

if (messageForm) {
  // Tamu menekan tombol kirim -> popup verifikasi muncul kembali
  const sendBtn = messageForm.querySelector('button[type="submit"]');
  if (sendBtn) {
    sendBtn.addEventListener("click", (e) => {
      if (!canSendMessage()) {
        e.preventDefault();
        openAuthPopup(true);
      }
    });
  }

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!canSendMessage()) {
      openAuthPopup(true);
      return;
    }

    const nameInput = $("senderName");
    const messageInput = $("messageText");
    const submitBtn = messageForm.querySelector('button[type="submit"]');

    const name = nameInput.value.trim().slice(0, 20);
    const message = messageInput.value.trim().slice(0, 200);

    if (!name || !message) {
      alert("Nama dan pesan wajib diisi.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Mengirim…";

    try {
      await addDoc(collection(db, "messages"), {
        name,
        message,
        uid: currentUser.uid,
        createdAt: serverTimestamp(),
      });

      currentSlide = 0;
      messageInput.value = "";
      showPopup();
    } catch (err) {
      console.error("Gagal mengirim pesan:", err);
      alert(
        err.code === "permission-denied"
          ? "Pesan ditolak server. Pastikan Firestore Rules sudah dipasang."
          : err.message || "Gagal mengirim pesan."
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Kirim Pesan";
    }
  });
}

if (popupOkBtn) popupOkBtn.addEventListener("click", hidePopup);
if (successPopup) {
  successPopup.addEventListener("click", (e) => {
    if (e.target === successPopup) hidePopup();
  });
}

// ===== Muat data awal =====
loadMessages();
loadGallery();

// ===== Active nav on scroll =====
const sections = document.querySelectorAll("section[id]");
const navAnchors = document.querySelectorAll(".nav-links a");

function updateActiveNav() {
  const y = window.scrollY + 100;
  sections.forEach((section) => {
    if (y >= section.offsetTop && y < section.offsetTop + section.offsetHeight) {
      const id = section.getAttribute("id");
      navAnchors.forEach((a) => {
        a.classList.toggle("active", a.getAttribute("href") === "#" + id);
      });
    }
  });
}

window.addEventListener("scroll", updateActiveNav, { passive: true });
updateActiveNav();