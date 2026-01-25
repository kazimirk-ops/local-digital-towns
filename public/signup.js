const $ = (id) => document.getElementById(id);

let selectedPlan = "user";
let referralCode = null;

function showError(msg) {
  const el = $("errorMsg");
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function showSuccess(msg) {
  const el = $("successMsg");
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

function selectPlan(plan) {
  selectedPlan = plan;
  document.querySelectorAll(".plan-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.plan === plan);
  });
  // Update button text based on plan
  const btn = $("subscribeBtn");
  const price = plan === "business" ? "$10" : "$5";
  btn.textContent = `Start 7-Day Free Trial`;
}

async function validateReferralCode(code) {
  try {
    const res = await fetch(`/api/referral/validate/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (data.valid) {
      referralCode = code;
      $("referralBox").style.display = "block";
      $("referrerName").textContent = data.referrerName || "a member";
      return true;
    }
  } catch (e) {
    console.error("Referral validation error:", e);
  }
  return false;
}

async function startCheckout() {
  showError("");
  showSuccess("");

  const email = ($("email").value || "").trim().toLowerCase();
  const displayName = ($("displayName").value || "").trim();

  if (!email) {
    showError("Please enter your email address.");
    $("email").focus();
    return;
  }

  if (!email.includes("@") || !email.includes(".")) {
    showError("Please enter a valid email address.");
    $("email").focus();
    return;
  }

  const btn = $("subscribeBtn");
  btn.disabled = true;
  btn.textContent = "Processing...";

  try {
    const res = await fetch("/api/signup/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        displayName,
        plan: selectedPlan,
        referralCode: referralCode || null
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to create checkout");
    }

    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    } else {
      throw new Error("No checkout URL received");
    }
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    selectPlan(selectedPlan); // Reset button text
  }
}

// Check for referral code in URL
function checkReferralCode() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  if (ref) {
    validateReferralCode(ref);
  }
}

// Check if already logged in
async function checkSession() {
  try {
    const res = await fetch("/me");
    const data = await res.json();
    if (data.user) {
      // Already logged in, check subscription
      const subRes = await fetch("/api/user/subscription");
      const subData = await subRes.json();
      if (subData.isActive) {
        // Already has active subscription, redirect to town
        window.location.href = "/ui";
      } else {
        // Logged in but no subscription, redirect to subscription page
        window.location.href = "/subscription";
      }
    }
  } catch (e) {
    // Not logged in, that's fine
  }
}

// Allow pressing Enter in email field to proceed
$("email").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    startCheckout();
  }
};

$("displayName").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    startCheckout();
  }
};

// Initialize
checkSession();
checkReferralCode();
selectPlan("user"); // Set initial button text
