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

function showError(msg) {
  const el = $("errorMsg");
  el.textContent = msg;
  el.style.display = "block";
}

function hideError() {
  $("errorMsg").style.display = "none";
}

async function loadSubscriptionStatus() {
  try {
    const me = await api("/me");
    if (!me?.user) {
      window.location.href = "/signup";
      return;
    }

    // Check if user has an active subscription
    const subRes = await api("/api/user/subscription");

    $("loadingState").style.display = "none";
    $("plansGrid").style.display = "grid";

    if (subRes.subscription && subRes.isActive) {
      $("statusCard").style.display = "block";
      $("statusBadge").textContent = subRes.subscription.plan === "business" ? "Business" : "User";
      $("statusBadge").className = "status-badge active";
      $("statusText").textContent = `Your ${subRes.subscription.plan} subscription is active.`;

      // Update buttons
      $("subscribeUserBtn").textContent = "Current Plan";
      $("subscribeUserBtn").disabled = subRes.subscription.plan === "user";
      $("subscribeBusinessBtn").textContent = subRes.subscription.plan === "business" ? "Current Plan" : "Upgrade — $10/mo";
      $("subscribeBusinessBtn").disabled = subRes.subscription.plan === "business";
    }
  } catch (e) {
    $("loadingState").style.display = "none";
    $("plansGrid").style.display = "grid";
    // No subscription - show plans
  }
}

async function subscribe(plan) {
  hideError();
  try {
    const res = await api("/api/subscription/checkout", {
      method: "POST",
      body: JSON.stringify({ plan })
    });
    if (res.checkoutUrl) {
      window.location.href = res.checkoutUrl;
    } else {
      showError("Failed to create checkout session");
    }
  } catch (e) {
    showError(e.message);
  }
}

$("subscribeUserBtn")?.addEventListener("click", () => subscribe("user"));
$("subscribeBusinessBtn")?.addEventListener("click", () => subscribe("business"));

loadSubscriptionStatus();
