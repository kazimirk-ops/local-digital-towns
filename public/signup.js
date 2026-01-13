const $ = (id) => document.getElementById(id);

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
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

$("submitSignup").onclick = async () => {
  try {
    dbg("");
    const payload = {
      name: $("name").value,
      email: $("email").value,
      address1: $("address1").value,
      address2: $("address2").value,
      city: $("city").value,
      state: $("state").value,
      zip: $("zip").value,
    };

    const data = await postJSON("/api/signup", payload);

    if (data.status === "eligible") {
      showSignup(`<div class="ok"><strong>✅ Eligible</strong><div class="muted">${data.reason}</div></div>`);
    } else {
      showSignup(`<div class="warn"><strong>🟡 Waitlist</strong><div class="muted">${data.reason}</div></div>`);
    }

    // Encourage login using same email
    $("loginEmail").value = payload.email || "";
  } catch (e) {
    dbg(`ERROR: ${e.message}`);
  }
};

$("requestLink").onclick = async () => {
  try {
    dbg("");
    const email = $("loginEmail").value.trim();
    if (!email) return dbg("Enter email for login.");

    const data = await postJSON("/auth/request-link", { email });

    showLogin(`
      <div class="ok">
        <strong>✅ Magic link created</strong>
        <div class="muted">Expires: ${data.expiresAt}</div>
        <div style="margin-top:8px;"><a href="${data.magicUrl}">Click here to log in</a></div>
      </div>
    `);
  } catch (e) {
    dbg(`ERROR: ${e.message}`);
  }
};

