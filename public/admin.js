async function api(url) {
  const res = await fetch(url);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function esc(s){ return (s ?? "").toString().replaceAll("<","&lt;").replaceAll(">","&gt;"); }

async function main() {
  const pulse = await api("/api/admin/pulse?hours=24");
  document.getElementById("pulseMeta").textContent = `Since: ${pulse.since}`;
  document.getElementById("pulseSessions").textContent = `Sessions: ${pulse.sessions}`;

  const countsHtml = pulse.counts.map((r) => `<span style="display:inline-block;margin:4px;padding:6px 10px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.06);font-size:12px;">${esc(r.eventType)}: <strong>${r.c}</strong></span>`).join("");
  document.getElementById("pulseCounts").innerHTML = countsHtml || "(no events yet)";

  const places = await api("/api/admin/places?hours=24");
  const rows = places.map((p) => `<tr>
    <td>${esc(p.placeName)} <span style="opacity:.6">(#${p.placeId})</span></td>
    <td>${p.views}</td>
    <td>${p.messages}</td>
    <td>${p.listingCreates}</td>
    <td>${p.events}</td>
  </tr>`).join("");
  document.getElementById("placeRows").innerHTML = rows || `<tr><td colspan="5">(no place events yet)</td></tr>`;

  const events = await api("/api/admin/events");
  document.getElementById("recentEvents").textContent = JSON.stringify(events, null, 2);
}

main().catch((e) => {
  document.getElementById("recentEvents").textContent = "ERROR: " + e.message + "\n\n(You must be logged in. Go to /signup, log in, then refresh.)";
});

