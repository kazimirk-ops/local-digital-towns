const $ = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(data.error || data || "Request failed");
  return data;
}

function fmtCents(c) {
  return `$${(Number(c || 0) / 100).toFixed(2)}`;
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function showSuccess(msg) {
  const el = $("successMsg");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

function showError(msg) {
  const el = $("errorMsg");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 5000);
}

function showCopyFeedback() {
  const el = $("copyFeedback");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1500);
}

async function loadReferralData() {
  try {
    // Check if logged in
    const me = await api("/me");
    if (!me?.user) {
      window.location.href = "/signup";
      return;
    }

    // Load stats
    const stats = await api("/api/referral/stats");

    $("loadingState").style.display = "none";
    $("mainContent").style.display = "block";

    // Display referral code
    const code = stats.referralCode || "--------";
    $("referralCode").textContent = code;

    const baseUrl = window.location.origin;
    const referralLink = `${baseUrl}/signup?ref=${code}`;
    $("referralLink").textContent = referralLink;

    // Display stats
    $("statBalance").textContent = fmtCents(stats.referralBalanceCents);
    $("statEarnings").textContent = fmtCents(stats.referralEarningsTotal);
    $("statReferred").textContent = stats.totalReferred || 0;
    $("statActive").textContent = stats.activeReferred || 0;

    // Enable cashout button if balance >= $25
    const cashoutBtn = $("cashoutBtn");
    if (stats.referralBalanceCents >= 2500) {
      cashoutBtn.disabled = false;
      cashoutBtn.textContent = `Request Cashout (${fmtCents(stats.referralBalanceCents)})`;
    } else {
      cashoutBtn.disabled = true;
      cashoutBtn.textContent = `Request Cashout ($25 min, you have ${fmtCents(stats.referralBalanceCents)})`;
    }

    // Load transactions
    const { transactions } = await api("/api/referral/transactions");
    if (transactions && transactions.length > 0) {
      $("historyCard").style.display = "block";
      const tbody = $("historyBody");
      tbody.innerHTML = "";

      for (const tx of transactions) {
        const row = document.createElement("tr");
        const type = tx.type === "commission" ? "Commission" :
                     tx.type === "credit_applied" ? "Credit Applied" :
                     tx.type === "cashout" ? "Cashout" : tx.type;
        const typeClass = tx.type === "commission" ? "badge-success" :
                          tx.type === "cashout" ? "badge-pending" : "badge-none";

        row.innerHTML = `
          <td>${fmtDate(tx.createdAt || tx.createdat)}</td>
          <td><span class="badge ${typeClass}">${type}</span></td>
          <td style="color: ${tx.amountCents > 0 ? '#22c55e' : '#f87171'}">${tx.amountCents > 0 ? '+' : ''}${fmtCents(tx.amountCents)}</td>
          <td class="muted">${tx.description || tx.referredUserName || "—"}</td>
        `;
        tbody.appendChild(row);
      }
    }

    // Load referred users
    const { users } = await api("/api/referral/users");
    if (users && users.length > 0) {
      $("usersCard").style.display = "block";
      const tbody = $("usersBody");
      tbody.innerHTML = "";

      for (const user of users) {
        const row = document.createElement("tr");
        const status = user.subscriptionStatus === "active" ? "Active" :
                       user.subscriptionStatus ? user.subscriptionStatus : "No subscription";
        const statusClass = user.subscriptionStatus === "active" ? "badge-success" : "badge-none";

        row.innerHTML = `
          <td>${user.displayName || user.displayname || user.email || "User"}</td>
          <td>${fmtDate(user.createdAt || user.createdat)}</td>
          <td><span class="badge ${statusClass}">${status}</span></td>
        `;
        tbody.appendChild(row);
      }
    }

    // Setup copy buttons
    $("copyCodeBtn").addEventListener("click", () => {
      navigator.clipboard.writeText(code);
      showCopyFeedback();
    });

    $("copyLinkBtn").addEventListener("click", () => {
      navigator.clipboard.writeText(referralLink);
      showCopyFeedback();
    });

    // Setup cashout button
    cashoutBtn.addEventListener("click", async () => {
      if (cashoutBtn.disabled) return;

      if (!confirm(`Request cashout of ${fmtCents(stats.referralBalanceCents)}? Our team will process this manually within 5-7 business days.`)) {
        return;
      }

      try {
        cashoutBtn.disabled = true;
        cashoutBtn.textContent = "Processing...";
        const result = await api("/api/referral/cashout", { method: "POST" });
        showSuccess(`Cashout of ${fmtCents(result.cashoutAmountCents)} requested! We'll process it within 5-7 business days.`);
        // Reload to show updated balance
        setTimeout(() => location.reload(), 2000);
      } catch (e) {
        showError(e.message);
        cashoutBtn.disabled = false;
        cashoutBtn.textContent = `Request Cashout (${fmtCents(stats.referralBalanceCents)})`;
      }
    });

  } catch (e) {
    $("loadingState").textContent = `Error: ${e.message}`;
    console.error("Referral load error:", e);
  }
}

loadReferralData();
