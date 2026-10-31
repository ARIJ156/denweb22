// ============================================================
//  KONFIGURASI JADWAL SHOW (JKT48Connect)
//  1. Ambil API key di https://www.jkt48connect.my.id (docs: docs.jkt48connect.my.id)
//  2. Tempel di bawah ini, ATAU (lebih aman) buat Environment Variable
//     JKT48_API_KEY di Vercel -> key tidak terlihat pengunjung.
//     Kalau memakai env var, isi key di bawah dengan teks apa saja (jangan kosong).
// ============================================================
// Key pribadi (jkc_...).
export const JKT48_API_KEY = "jkc_59b8146271fd77e80085c17732ee98c7dcdfeb16";
// Fungsi server Vercel di api/theater.js (memanggil JKT48Connect dari server, bebas CORS)
export const JKT48_THEATER_URL = "/api/theater";

// Nama yang dicari di line-up show (tidak peka huruf besar/kecil)
export const MEMBER_KEYWORDS = ["danella", "dena natalia", "dena"];

// Lama cache di browser (menit)
export const CACHE_MINUTES = 15;
