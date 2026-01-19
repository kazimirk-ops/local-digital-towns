function $(id){ return document.getElementById(id); }

async function api(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try{ data = JSON.parse(text); }catch{ data = text; }
  if(!res.ok) throw new Error(typeof data === "string" ? data : JSON.stringify(data));
  return data;
}

function getDrawId(){
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

async function loadClaim(){
  const drawId = getDrawId();
  if(!drawId) return;
  $("claimDrawId").textContent = drawId;
  try{
    const data = await api(`/api/sweep/claim/${encodeURIComponent(drawId)}`);
    const prizeTitle = data.prize?.title || data.sweepPrize || data.sweepTitle || "Prize";
    $("claimPrize").textContent = prizeTitle;
    $("claimDonor").textContent = data.donorName || data.prize?.donorName || "Donor";
    const isClaimed = data.status === "claimed";
    $("claimStatus").textContent = isClaimed ? `Claimed at ${data.claimedAt || ""}` : "Pending confirmation";
    if(isClaimed){
      $("claimMessage").value = data.claimedMessage || "";
      $("claimMessage").disabled = true;
      $("claimPhoto").disabled = true;
      $("claimSubmitBtn").disabled = true;
      $("claimResult").textContent = "This prize has already been claimed.";
    }
  }catch(e){
    $("claimStatus").textContent = `Error: ${e.message}`;
    $("claimSubmitBtn").disabled = true;
  }
}

async function submitClaim(e){
  e.preventDefault();
  const drawId = getDrawId();
  if(!drawId) return;
  const btn = $("claimSubmitBtn");
  const result = $("claimResult");
  btn.disabled = true;
  result.textContent = "Submitting...";
  try{
    let photoUrl = "";
    const file = $("claimPhoto").files?.[0];
    if(file){
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "prize_claim_photo");
      const uploaded = await api("/api/uploads", { method:"POST", body: form });
      photoUrl = uploaded.url || "";
    }
    const payload = {
      messageToDonor: $("claimMessage").value.trim(),
      photoUrl
    };
    await api(`/api/sweep/claim/${encodeURIComponent(drawId)}`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    result.textContent = "Confirmed! Thank you.";
    await loadClaim();
  }catch(e){
    result.textContent = `Error: ${e.message}`;
    btn.disabled = false;
  }
}

document.getElementById("claimForm").addEventListener("submit", submitClaim);
loadClaim();
