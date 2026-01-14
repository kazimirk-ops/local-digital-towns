const $=id=>document.getElementById(id);
function debug(m){$("debug").textContent=m||"";}

async function api(u,o){
  const r=await fetch(u,{credentials:"include",headers:{"Content-Type":"application/json"},...(o||{})});
  const t=await r.text(); let j;
  try{j=JSON.parse(t)}catch{j=t}
  if(!r.ok) throw new Error(j.error||t);
  return j;
}
function pid(){return Number(location.pathname.split("/")[2]);}

let LIST=[],TAB="item";

function setTab(t){
  TAB=t;
  ["tabItems","tabOffers","tabRequests"].forEach(x=>$(x).classList.remove("active"));
  if(t==="item")$("tabItems").classList.add("active");
  if(t==="offer")$("tabOffers").classList.add("active");
  if(t==="request")$("tabRequests").classList.add("active");
  render();
}

function render(){
  const g=$("listingGrid"); g.innerHTML="";
  LIST.filter(l=>(l.listingType||"item")===TAB).forEach(l=>{
    const d=document.createElement("div");
    d.className="item";
    d.innerHTML=`
      <div class="muted">${l.listingType.toUpperCase()} • ${l.exchangeType}</div>
      <div style="font-weight:900">${l.title}</div>
      <div class="muted">${l.description}</div>
      ${l.listingType!=="item"?`<button data-id="${l.id}">Apply / Message</button>`:""}
    `;
    const b=d.querySelector("button");
    if(b) b.onclick=()=>apply(l.id);
    g.appendChild(d);
  });
}

async function apply(id){
  try{
    await api(`/listings/${id}/apply`,{method:"POST",body:JSON.stringify({message:"Interested"})});
    alert("Conversation started.");
  }catch(e){alert(e.message)}
}

async function main(){
  const id=pid();
  $("tabItems").onclick=()=>setTab("item");
  $("tabOffers").onclick=()=>setTab("offer");
  $("tabRequests").onclick=()=>setTab("request");

  try{
    LIST=await api(`/places/${id}/listings`);
    setTab("item");
    debug("Ready.");
  }catch(e){debug(e.message)}
}
main();
