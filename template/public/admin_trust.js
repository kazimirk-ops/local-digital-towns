async function api(url){
  const res=await fetch(url);
  const text=await res.text();
  let data; try{data=JSON.parse(text)}catch{data=text}
  if(!res.ok) throw new Error(data.error||text);
  return data;
}
async function postJSON(url, payload){
  const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload||{})});
  const text=await res.text();
  let data; try{data=JSON.parse(text)}catch{data=text}
  if(!res.ok) throw new Error(data.error||text);
  return data;
}
function renderList(el, items, title){
  if(!items.length){ el.innerHTML=`<div class="muted">No ${title}.</div>`; return; }
  el.innerHTML="";
  items.forEach(i=>{
    const div=document.createElement("div");
    div.className="item";
    const leftLabel = i.reporterTrustTierLabel || i.reviewerTrustTierLabel || "";
    const rightLabel = i.revieweeTrustTierLabel || "";
    div.innerHTML=`<div><strong>Order ${i.orderId}</strong> • ${i.status || ""}</div>
      <div class="muted">${i.reason || i.text || ""}</div>
      <div class="muted">User ${i.reporterUserId || i.reviewerUserId}${leftLabel ? ` (${leftLabel})` : ""} → ${i.revieweeUserId || ""}${rightLabel ? ` (${rightLabel})` : ""}</div>`;
    el.appendChild(div);
  });
}
function renderTrustApps(el, apps){
  if(!apps.length){ el.innerHTML=`<div class="muted">No pending applications.</div>`; return; }
  el.innerHTML="";
  apps.forEach((a)=>{
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<div><strong>${a.email}</strong> • Tier ${a.requestedTier} • ${a.status}</div>
      <div class="muted">${a.address1}, ${a.city}, ${a.state} ${a.zip}</div>
      <div class="muted">Phone: ${a.phone || "—"} • Identity: ${a.identityMethod || "—"} (${a.identityStatus || "pending"})</div>
      <div class="row" style="margin-top:8px; gap:8px;">
        <input placeholder="Decision reason (reject only)" data-reason="${a.id}" style="flex:1; padding:8px; border-radius:8px; border:1px solid #223149; background:#0b1220; color:#e8eef6;" />
        <button data-approve="${a.id}">Approve</button>
        <button data-reject="${a.id}">Reject</button>
      </div>`;
    div.querySelector("button[data-approve]").onclick=async()=>{
      await postJSON(`/api/admin/trust/apps/${a.id}/approve`, {});
      await loadTrustApps();
    };
    div.querySelector("button[data-reject]").onclick=async()=>{
      const reason=div.querySelector(`input[data-reason="${a.id}"]`).value.trim();
      if(!reason) return alert("Reason required.");
      await postJSON(`/api/admin/trust/apps/${a.id}/reject`, { reason });
      await loadTrustApps();
    };
    el.appendChild(div);
  });
}
async function loadTrustApps(){
  const apps=await api("/api/admin/trust/apps?status=pending");
  renderTrustApps(document.getElementById("trustApps"), apps);
}
(async()=>{
  const disputes=await api("/api/admin/trust/disputes");
  const reviews=await api("/api/admin/trust/reviews");
  renderList(document.getElementById("disputes"), disputes, "disputes");
  renderList(document.getElementById("reviews"), reviews, "reviews");
  await loadTrustApps();
})().catch(e=>{
  document.body.insertAdjacentHTML("beforeend", `<div class="muted" style="padding:16px;">ERROR: ${e.message}</div>`);
});
