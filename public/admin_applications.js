const TIERS = {
  1: "Tier 1: Verified Visitor",
  2: "Tier 2: Verified Resident",
  3: "Tier 3: Moderator",
  4: "Tier 4: Local Business",
  5: "Tier 5: Admin"
};

async function api(url, options = {}){
  const res = await fetch(url, { credentials: "include", ...options });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function postStatusWithTier(url, status, approvedTier){
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, approvedTier })
  });
}

function td(text){
  const cell = document.createElement("td");
  cell.textContent = text == null ? "" : String(text);
  return cell;
}

function tierSelect(id, defaultTier){
  const select = document.createElement("select");
  select.id = id;
  select.style.marginRight = "8px";
  for(const [value, label] of Object.entries(TIERS)){
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if(Number(value) === defaultTier) opt.selected = true;
    select.appendChild(opt);
  }
  return select;
}

function actionsCell(rowId, prefix, defaultTier, onApprove, onReject){
  const cell = document.createElement("td");
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "6px";

  const tierRow = document.createElement("div");
  const select = tierSelect(`${prefix}-tier-${rowId}`, defaultTier);
  tierRow.appendChild(select);
  container.appendChild(tierRow);

  const btnRow = document.createElement("div");
  btnRow.className = "row";
  const approve = document.createElement("button");
  approve.className = "btn btn-approve";
  approve.type = "button";
  approve.textContent = "Approve";
  approve.onclick = () => {
    const tier = Number(document.getElementById(`${prefix}-tier-${rowId}`).value);
    onApprove(tier);
  };
  const reject = document.createElement("button");
  reject.className = "btn btn-reject";
  reject.type = "button";
  reject.textContent = "Reject";
  reject.onclick = onReject;
  btnRow.appendChild(approve);
  btnRow.appendChild(reject);
  container.appendChild(btnRow);

  cell.appendChild(container);
  return cell;
}

async function loadWaitlist(){
  const status = document.getElementById("waitlistStatus").value;
  const msg = document.getElementById("waitlistMsg");
  msg.textContent = "Loading...";
  try{
    const rows = await api(`/api/admin/waitlist?status=${encodeURIComponent(status)}`);
    const body = document.getElementById("waitlistRows");
    body.innerHTML = "";
    if(!rows.length){
      msg.textContent = "No entries.";
      return;
    }
    rows.forEach((row)=>{
      const tr = document.createElement("tr");
      tr.appendChild(td(row.createdAt));
      tr.appendChild(td(row.name || ""));
      tr.appendChild(td(row.email));
      tr.appendChild(td(row.interests || ""));
      tr.appendChild(td(row.status + (row.approvedTier ? ` (Tier ${row.approvedTier})` : "")));
      tr.appendChild(actionsCell(row.id, "waitlist", row.approvedtier || 1,
        async (tier)=>{ await postStatusWithTier(`/api/admin/waitlist/${row.id}/status`, "approved", tier); loadWaitlist(); },
        async ()=>{ await postStatusWithTier(`/api/admin/waitlist/${row.id}/status`, "rejected", null); loadWaitlist(); }
      ));
      body.appendChild(tr);
    });
    msg.textContent = "";
  }catch(err){
    msg.textContent = err.message;
  }
}

async function loadBusiness(){
  const status = document.getElementById("businessStatus").value;
  const msg = document.getElementById("businessMsg");
  msg.textContent = "Loading...";
  try{
    const rows = await api(`/api/admin/applications/business?status=${encodeURIComponent(status)}`);
    const body = document.getElementById("businessRows");
    body.innerHTML = "";
    if(!rows.length){
      msg.textContent = "No applications.";
      return;
    }
    rows.forEach((row)=>{
      const tr = document.createElement("tr");
      tr.appendChild(td(row.createdAt));
      tr.appendChild(td(`${row.contactName} (${row.email})`));
      tr.appendChild(td(row.businessName));
      tr.appendChild(td(row.type));
      tr.appendChild(td(row.category));
      tr.appendChild(td(row.inSebastian));
      tr.appendChild(td(row.status + (row.approvedTier ? ` (Tier ${row.approvedTier})` : "")));
      tr.appendChild(actionsCell(row.id, "business", row.approvedtier || 4,
        async (tier)=>{ await postStatusWithTier(`/api/admin/applications/business/${row.id}/status`, "approved", tier); loadBusiness(); },
        async ()=>{ await postStatusWithTier(`/api/admin/applications/business/${row.id}/status`, "rejected", null); loadBusiness(); }
      ));
      body.appendChild(tr);
    });
    msg.textContent = "";
  }catch(err){
    msg.textContent = err.message;
  }
}

async function loadResident(){
  const status = document.getElementById("residentStatus").value;
  const msg = document.getElementById("residentMsg");
  msg.textContent = "Loading...";
  try{
    const rows = await api(`/api/admin/applications/resident?status=${encodeURIComponent(status)}`);
    const body = document.getElementById("residentRows");
    body.innerHTML = "";
    if(!rows.length){
      msg.textContent = "No applications.";
      return;
    }
    rows.forEach((row)=>{
      const tr = document.createElement("tr");
      tr.appendChild(td(row.createdAt));
      tr.appendChild(td(row.name));
      tr.appendChild(td(row.email));
      tr.appendChild(td(`${row.city}, ${row.state}`));
      tr.appendChild(td(row.yearsInSebastian || ""));
      tr.appendChild(td(row.status + (row.approvedTier ? ` (Tier ${row.approvedTier})` : "")));
      tr.appendChild(actionsCell(row.id, "resident", row.approvedtier || 2,
        async (tier)=>{ await postStatusWithTier(`/api/admin/applications/resident/${row.id}/status`, "approved", tier); loadResident(); },
        async ()=>{ await postStatusWithTier(`/api/admin/applications/resident/${row.id}/status`, "rejected", null); loadResident(); }
      ));
      body.appendChild(tr);
    });
    msg.textContent = "";
  }catch(err){
    msg.textContent = err.message;
  }
}

document.getElementById("waitlistStatus").addEventListener("change", loadWaitlist);
document.getElementById("businessStatus").addEventListener("change", loadBusiness);
document.getElementById("residentStatus").addEventListener("change", loadResident);

loadWaitlist();
loadBusiness();
loadResident();
