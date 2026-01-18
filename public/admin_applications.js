async function api(url, options = {}){
  const res = await fetch(url, { credentials: "include", ...options });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function postStatus(url, status){
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

function td(text){
  const cell = document.createElement("td");
  cell.textContent = text == null ? "" : String(text);
  return cell;
}

function actionsCell(onApprove, onReject){
  const cell = document.createElement("td");
  const row = document.createElement("div");
  row.className = "row";
  const approve = document.createElement("button");
  approve.className = "btn btn-approve";
  approve.type = "button";
  approve.textContent = "Approve";
  approve.onclick = onApprove;
  const reject = document.createElement("button");
  reject.className = "btn btn-reject";
  reject.type = "button";
  reject.textContent = "Reject";
  reject.onclick = onReject;
  row.appendChild(approve);
  row.appendChild(reject);
  cell.appendChild(row);
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
      tr.appendChild(td(row.status));
      tr.appendChild(actionsCell(
        async ()=>{ await postStatus(`/api/admin/waitlist/${row.id}/status`, "approved"); loadWaitlist(); },
        async ()=>{ await postStatus(`/api/admin/waitlist/${row.id}/status`, "rejected"); loadWaitlist(); }
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
      tr.appendChild(td(row.status));
      tr.appendChild(actionsCell(
        async ()=>{ await postStatus(`/api/admin/applications/business/${row.id}/status`, "approved"); loadBusiness(); },
        async ()=>{ await postStatus(`/api/admin/applications/business/${row.id}/status`, "rejected"); loadBusiness(); }
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
      tr.appendChild(td(row.status));
      tr.appendChild(actionsCell(
        async ()=>{ await postStatus(`/api/admin/applications/resident/${row.id}/status`, "approved"); loadResident(); },
        async ()=>{ await postStatus(`/api/admin/applications/resident/${row.id}/status`, "rejected"); loadResident(); }
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
