async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function esc(s){ return (s ?? "").toString().replaceAll("<","&lt;").replaceAll(">","&gt;"); }

async function loadMedia(){
  const townId = document.getElementById("mediaTownId").value || "1";
  const kind = document.getElementById("mediaKind").value;
  const qs = new URLSearchParams({ townId, kind });
  const media = await api(`/api/admin/media?${qs.toString()}`);
  const body = document.getElementById("mediaRows");
  body.innerHTML = "";
  if(!media.length){
    body.innerHTML = `<tr><td colspan="8">(no media)</td></tr>`;
    return;
  }
  media.forEach((m)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.url ? `<img src="${m.url}" alt="">` : "-"}</td>
      <td>${esc(m.kind)}</td>
      <td>${m.ownerUserId}</td>
      <td>${m.placeId ?? "-"}</td>
      <td>${m.bytes}</td>
      <td>${esc(m.mime)}</td>
      <td>${esc(m.storageDriver)}</td>
      <td><a href="${m.url}" target="_blank" rel="noopener">open</a></td>
    `;
    body.appendChild(tr);
  });
}

async function loadOrphans(){
  const townId = document.getElementById("mediaTownId").value || "1";
  const qs = new URLSearchParams({ townId });
  const data = await api(`/api/admin/media/orphans?${qs.toString()}`);
  const rows = document.getElementById("orphansRows");
  const meta = document.getElementById("orphansMeta");
  rows.innerHTML = "";
  const orphans = data.orphans || [];
  const missing = data.missingLocal || [];
  meta.textContent = `orphans: ${orphans.length} • missing(local): ${missing.length}`;
  orphans.forEach((m)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>orphan</td><td>${esc(m.kind)}</td><td>${m.ownerUserId}</td><td>${esc(m.url)}</td>`;
    rows.appendChild(tr);
  });
  missing.forEach((m)=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>missing</td><td>${esc(m.kind)}</td><td>${m.ownerUserId}</td><td>${esc(m.url)}</td>`;
    rows.appendChild(tr);
  });
}

document.getElementById("mediaReload").onclick = () => loadMedia().catch(e => {
  document.getElementById("mediaMsg").textContent = `ERROR: ${e.message}`;
});
document.getElementById("loadOrphans").onclick = () => loadOrphans().catch(e => {
  document.getElementById("mediaMsg").textContent = `ERROR: ${e.message}`;
});

loadMedia().catch(e=>{
  document.getElementById("mediaMsg").textContent = `ERROR: ${e.message}`;
});
