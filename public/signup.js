const $ = (id) => document.getElementById(id);
const tc = window.__TOWN_CONFIG__ || {};
let presenceOk = false;
let pendingEmail = "";

function showSignup(html) { $("signupResult").innerHTML = html; }
function showLogin(html) { $("loginResult").innerHTML = html; }
function dbg(msg) { $("debug").textContent = msg || ""; }

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data && (data.error || data.message) ? (data.error || data.message) : "Request failed.";
    throw new Error(msg);
  }
  return data;
}

async function getSessionUser(){
  try{
    const res = await fetch("/me");
    const data = await res.json();
    return data.user || null;
  }catch{
    return null;
  }
}

async function requireLogin(message){
  const user = await getSessionUser();
  if(user) return user;
  showSignup(`<div class="warn"><strong>Login required</strong><div class="muted">${message}</div></div>`);
  return null;
}

async function setAuthUI(){
  const user = await getSessionUser();
  const card = $("trustApplyCard");
  if(card) card.style.display = user ? "block" : "none";
  if(user && $("email")) $("email").value = user.email || "";
  if(!user) $("trustStatus").textContent = "Log in to apply for higher tiers.";
}

async function loadTrustStatus(){
  try{
    const ctx = await fetch("/town/context").then(r=>r.json());
    $("tierBadge").textContent = `Tier ${ctx.trustTier || 0}: ${ctx.tierName || ctx.trustTierLabel || "Visitor"}`;
    const res = await fetch("/api/trust/my");
    if(res.status === 401){
      $("trustStatus").textContent = "Log in to see your application status.";
      return;
    }
    const my = await res.json();
    const apps = my.applications || [];
    if(apps.length){
      const last = apps[0];
      $("trustStatus").textContent = `Latest application: Tier ${last.requestedTier} • ${last.status}`;
    }else{
      $("trustStatus").textContent = "No applications yet.";
    }
  }catch{}
}

$("verifyPresenceBtn").onclick = async () => {
  const user = await requireLogin("Log in with the email code below before location verification.");
  if(!user) return;
  presenceOk = false;
  $("presenceStatus").textContent = "Checking location...";
  if(!navigator.geolocation){
    $("presenceStatus").textContent = "Geolocation not available.";
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos)=>{
    try{
      const payload = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude
      };
      const res = await postJSON("/api/verify/location", payload);
      presenceOk = !!res.ok;
      $("presenceStatus").textContent = res.ok
        ? (tc.verification?.locationVerifiedMessage || "Location verified in Sebastian.")
        : (tc.verification?.outsideBoxMessage || "Not inside Sebastian verification box.");
    }catch(e){
      $("presenceStatus").textContent = `Location verify failed: ${e.message}`;
    }
  }, (err)=>{
    $("presenceStatus").textContent = `Location denied: ${err.message}`;
  }, { enableHighAccuracy: true, timeout: 10000 });
};

$("submitTrust").onclick = async () => {
  try {
    dbg("");
    const user = await requireLogin("Log in with the email code below before submitting a tier application.");
    if(!user) return;
    const payload = {
      requestedTier: Number($("requestedTier").value || 1),
      email: $("email").value,
      phone: $("phone").value,
      address1: $("address1").value,
      address2: $("address2").value,
      city: $("city").value,
      state: $("state").value,
      zip: $("zip").value,
      identityMethod: $("identityMethod").value
    };
    if(payload.requestedTier === 1 && !presenceOk){
      return showSignup(`<div class="warn"><strong>Location required</strong><div class="muted">${tc.verification?.locationRequiredMessage || "Verify location in Sebastian before submitting Tier 1."}</div></div>`);
    }
    const data = await postJSON("/api/trust/apply", payload);
    const statusText = data.status === "approved"
      ? "Auto‑approved. Your tier is now active."
      : "Pending admin review.";
    showSignup(`<div class="ok"><strong>✅ Submitted</strong><div class="muted">Application #${data.id}. ${statusText}</div></div>`);

    // Encourage login using same email
    $("loginEmail").value = payload.email || "";
    await loadTrustStatus();

    // Prompt to share verification if approved
    if(data.status === "approved" && window.ShareModal){
      const tierNames = { 0: "Visitor", 1: "Individual", 2: "Moderator", 3: "Local Business", 4: "Admin" };
      const tierName = tierNames[payload.requestedTier] || (tc.verification?.defaultTierName || "Sebastian local");
      setTimeout(() => ShareModal.promptVerificationShare(tierName), 1000);
    }
  } catch (e) {
    dbg(`ERROR: ${e.message}`);
  }
};

function showCodeVerifySection(show) {
  $("codeVerifySection").style.display = show ? "block" : "none";
}

$("requestCode").onclick = async () => {
  try {
    dbg("");
    const email = $("loginEmail").value.trim();
    if (!email) return dbg("Enter email for login.");

    await postJSON("/api/auth/request-code", { email });
    pendingEmail = email;
    showCodeVerifySection(true);
    $("loginCode").value = "";
    $("loginCode").focus();
    showLogin(`
      <div class="ok">
        <strong>✅ Code sent</strong>
        <div class="muted">Check your email for the 6-digit code.</div>
      </div>
    `);
  } catch (e) {
    dbg(`ERROR: ${e.message}`);
  }
};

async function verifyCode() {
  try {
    dbg("");
    const email = (pendingEmail || $("loginEmail").value.trim()).trim();
    const code = $("loginCode").value.trim();
    if (!email) return dbg("Enter email for login.");
    if (!code || code.length !== 6) return dbg("Enter the 6-digit code.");

    await postJSON("/api/auth/verify-code", { email, code });
    showLogin(`
      <div class="ok">
        <strong>✅ Logged in</strong>
        <div class="muted">Redirecting to town...</div>
      </div>
    `);
    setTimeout(() => { window.location.href = "/ui"; }, 600);
  } catch (e) {
    dbg(`ERROR: ${e.message}`);
  }
}

$("verifyCodeBtn").onclick = verifyCode;

// Only allow 6 digits in the code input
$("loginCode").oninput = (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
};

// Allow pressing Enter in the code field to submit
$("loginCode").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    verifyCode();
  }
};

// Allow pressing Enter in the email field to request code
$("loginEmail").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("requestCode").click();
  }
};

setAuthUI().then(loadTrustStatus).catch(()=>{});
