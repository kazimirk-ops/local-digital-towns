const $ = (id) => document.getElementById(id);

function show(html) {
  $("result").innerHTML = html;
}

async function postSignup(payload) {
  const res = await fetch("/api/signup", {
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

$("submit").onclick = async () => {
  try {
    $("debug").textContent = "";

    const payload = {
      name: $("name").value,
      email: $("email").value,
      address1: $("address1").value,
      address2: $("address2").value,
      city: $("city").value,
      state: $("state").value,
      zip: $("zip").value,
    };

    const data = await postSignup(payload);

    if (data.status === "eligible") {
      show(`<div class="ok"><strong>✅ Eligible for Sebastian Pilot</strong><div class="muted">${data.reason}</div></div>`);
    } else {
      show(`<div class="warn"><strong>🟡 Added to Waitlist</strong><div class="muted">${data.reason}</div></div>`);
    }
  } catch (e) {
    $("debug").textContent = `ERROR: ${e.message}`;
  }
};

