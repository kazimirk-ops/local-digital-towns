async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function isoNowPlus(min) {
  return toLocalInputValue(new Date(Date.now() + min * 60 * 1000));
}

// Prefill sweepstake ISO fields
document.getElementById("sStart").value = isoNowPlus(0);
document.getElementById("sEnd").value = isoNowPlus(60);
document.getElementById("sDraw").value = isoNowPlus(61);

// Link dropdown → custom field
document.getElementById("newEventSelect").onchange = () => {
  const v = document.getElementById("newEventSelect").value;
  if (v) document.getElementById("newEventType").value = v;
};

function ruleRow(rule) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input value="${rule.matchEventType}" data-k="matchEventType" style="width:220px;"></td>
    <td><input type="checkbox" ${rule.enabled ? "checked" : ""} data-k="enabled"></td>
    <td><input value="${rule.buyerAmount}" data-k="buyerAmount" style="width:70px"></td>
    <td><input value="${rule.sellerAmount}" data-k="sellerAmount" style="width:70px"></td>
    <td><input value="${rule.dailyCap}" data-k="dailyCap" style="width:90px"></td>
    <td><input value="${rule.cooldownSeconds}" data-k="cooldownSeconds" style="width:120px"></td>
    <td><button data-action="save">Save</button></td>
  `;

  tr.querySelector('button[data-action="save"]').onclick = async () => {
    try {
      const payload = {
        matchEventType: tr.querySelector('[data-k="matchEventType"]').value.trim(),
        enabled: tr.querySelector('[data-k="enabled"]').checked,
        buyerAmount: Number(tr.querySelector('[data-k="buyerAmount"]').value),
        sellerAmount: Number(tr.querySelector('[data-k="sellerAmount"]').value),
        dailyCap: Number(tr.querySelector('[data-k="dailyCap"]').value),
        cooldownSeconds: Number(tr.querySelector('[data-k="cooldownSeconds"]').value),
      };

      const updated = await api(`/api/admin/sweep/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      document.getElementById("ruleMsg").textContent = `Saved rule #${updated.id} (${updated.matchEventType})`;
      await loadRules();
    } catch (e) {
      document.getElementById("ruleMsg").textContent = `ERROR: ${e.message}`;
    }
  };

  return tr;
}

async function loadRules() {
  const rules = await api("/api/admin/sweep/rules");
  const body = document.getElementById("ruleRows");
  body.innerHTML = "";
  rules.forEach((r) => body.appendChild(ruleRow(r)));
}

document.getElementById("createRule").onclick = async () => {
  try {
    document.getElementById("createMsg").textContent = "";

    const matchEventType = document.getElementById("newEventType").value.trim();
    if (!matchEventType) {
      document.getElementById("createMsg").textContent = "ERROR: matchEventType required";
      return;
    }

    const payload = {
      matchEventType,
      enabled: document.getElementById("newEnabled").checked,
      buyerAmount: Number(document.getElementById("newBuyer").value),
      sellerAmount: Number(document.getElementById("newSeller").value),
      dailyCap: Number(document.getElementById("newCap").value),
      cooldownSeconds: Number(document.getElementById("newCooldown").value),
    };

    const created = await api("/api/admin/sweep/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    document.getElementById("createMsg").textContent = `Created rule #${created.id} (${created.matchEventType})`;
    await loadRules();
  } catch (e) {
    document.getElementById("createMsg").textContent = `ERROR: ${e.message}`;
  }
};

document.getElementById("createSweepstake").onclick = async () => {
  try {
    const startAt = document.getElementById("sStart").value;
    const endAt = document.getElementById("sEnd").value;
    const drawAt = document.getElementById("sDraw").value;
    const payload = {
      status: document.getElementById("sStatus").value,
      title: document.getElementById("sTitle").value,
      prize: document.getElementById("sPrize").value,
      entryCost: Number(document.getElementById("sCost").value),
      startAt: startAt ? new Date(startAt).toISOString() : "",
      endAt: endAt ? new Date(endAt).toISOString() : "",
      drawAt: drawAt ? new Date(drawAt).toISOString() : "",
    };

    const created = await api("/api/admin/sweep/sweepstake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    document.getElementById("sweepMsg").textContent = `Created sweepstake #${created.id} (${created.status})`;
  } catch (e) {
    document.getElementById("sweepMsg").textContent = `ERROR: ${e.message}`;
  }
};

loadRules().catch((e) => {
  document.getElementById("ruleMsg").textContent = `ERROR: ${e.message} (login required)`;
});
