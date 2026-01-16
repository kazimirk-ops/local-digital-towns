const $ = (id) => document.getElementById(id);

async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function setStatus(text) {
  const el = $("adminStatus");
  if (el) el.textContent = text;
}

async function loadMe() {
  try {
    const me = await api("/me");
    const user = me.user;
    if (!user) {
      setStatus("Not logged in. Enter your admin email to request a login link.");
      $("adminLogoutBtn").style.display = "none";
      return;
    }
    if (Number(user.isAdmin) === 1) {
      setStatus(`Logged in as admin: ${user.email}`);
      window.location.href = "/admin";
      return;
    }
    setStatus(`Logged in as ${user.email} (not admin). Log out to switch accounts.`);
    $("adminLogoutBtn").style.display = "inline-block";
  } catch (e) {
    setStatus(`ERROR: ${e.message}`);
  }
}

async function requestLink() {
  try {
    $("adminLoginDebug").textContent = "";
    const email = $("adminEmail").value.trim();
    if (!email) return $("adminLoginDebug").textContent = "Enter admin email.";
    const data = await api("/auth/request-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    $("adminLoginResult").innerHTML = `
      <div class="pill">✅ Login link created</div>
      <div style="margin-top:8px;"><a href="${data.magicUrl}">Click here to log in</a></div>
    `;
  } catch (e) {
    $("adminLoginDebug").textContent = `ERROR: ${e.message}`;
  }
}

async function logout() {
  await api("/auth/logout", { method: "POST" });
  window.location.reload();
}

$("adminLoginBtn").onclick = requestLink;
$("adminLogoutBtn").onclick = logout;
loadMe().catch(() => {});
