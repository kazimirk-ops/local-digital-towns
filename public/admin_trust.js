async function api(url){
  const res=await fetch(url);
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
    div.innerHTML=`<div><strong>Order ${i.orderId}</strong> • ${i.status || ""}</div>
      <div class="muted">${i.reason || i.text || ""}</div>
      <div class="muted">User ${i.reporterUserId || i.reviewerUserId} → ${i.revieweeUserId || ""}</div>`;
    el.appendChild(div);
  });
}
(async()=>{
  const disputes=await api("/api/admin/trust/disputes");
  const reviews=await api("/api/admin/trust/reviews");
  renderList(document.getElementById("disputes"), disputes, "disputes");
  renderList(document.getElementById("reviews"), reviews, "reviews");
})().catch(e=>{
  document.body.insertAdjacentHTML("beforeend", `<div class="muted" style="padding:16px;">ERROR: ${e.message}</div>`);
});
