// Vercel Function: meneruskan permintaan ke JKT48Connect dari server (bebas CORS).
// Key diambil dari env JKT48_API_KEY (disarankan); kalau kosong, pakai ?apikey= dari browser.
module.exports = async (req, res) => {
  const key = process.env.JKT48_API_KEY || (req.query && req.query.apikey) || "";
  if (!key) return res.status(400).json({ error: "API key kosong" });
  try {
    const up = await fetch((process.env.JKT48_API_BASE || "https://v2.jkt48connect.com/api") + "/jkt48/theater?apikey=" + encodeURIComponent(key), {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; DanellaFanpage/1.0)" },
    });
    const text = await up.text();
    if (!up.ok) return res.status(up.status).json({ error: "upstream", upstreamStatus: up.status, detail: text.slice(0, 200) });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(text);
  } catch (e) {
    const c = e && e.cause;
    const why = c ? [c.code, c.hostname, c.message].filter(Boolean).join(" ") : "";
    return res.status(502).json({ error: "fetch gagal", detail: (String(e && e.message || e) + (why ? " (" + why + ")" : "")).slice(0, 200) });
  }
};
