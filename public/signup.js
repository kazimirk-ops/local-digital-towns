// Signup page JavaScript
(function() {
  const $ = (id) => document.getElementById(id);

  let selectedPlan = "user";
  let referralCode = null;

  function showError(msg) {
    const el = $("errorMsg");
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? "block" : "none";
    }
    if (msg) console.error("Signup error:", msg);
  }

  function showSuccess(msg) {
    const el = $("successMsg");
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? "block" : "none";
    }
  }

  function selectPlan(plan) {
    selectedPlan = plan;
    document.querySelectorAll(".plan-card").forEach(card => {
      card.classList.toggle("selected", card.dataset.plan === plan);
    });
    const btn = $("subscribeBtn");
    if (btn) {
      btn.textContent = "Start 7-Day Free Trial";
    }
  }

  async function validateReferralCode(code) {
    try {
      const res = await fetch(`/api/referral/validate/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.valid) {
        referralCode = code;
        const box = $("referralBox");
        const name = $("referrerName");
        if (box) box.style.display = "block";
        if (name) name.textContent = data.referrerName || "a member";
        return true;
      }
    } catch (e) {
      console.error("Referral validation error:", e);
    }
    return false;
  }

  async function startCheckout() {
    console.log("startCheckout called");
    showError("");
    showSuccess("");

    const emailEl = $("email");
    const displayNameEl = $("displayName");

    const email = (emailEl?.value || "").trim().toLowerCase();
    const displayName = (displayNameEl?.value || "").trim();

    if (!email) {
      showError("Please enter your email address.");
      if (emailEl) emailEl.focus();
      return;
    }

    if (!email.includes("@") || !email.includes(".")) {
      showError("Please enter a valid email address.");
      if (emailEl) emailEl.focus();
      return;
    }

    const btn = $("subscribeBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Processing...";
    }

    try {
      console.log("Calling /api/signup/checkout with:", { email, displayName, plan: selectedPlan });

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
      console.log("Checkout response:", data);

      if (!res.ok) {
        throw new Error(data.error || "Failed to create checkout");
      }

      if (data.checkoutUrl) {
        console.log("Redirecting to:", data.checkoutUrl);
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (e) {
      console.error("Checkout error:", e);
      showError(e.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Start 7-Day Free Trial";
      }
    }
  }

  function checkReferralCode() {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      validateReferralCode(ref);
    }
  }

  async function checkSession() {
    try {
      const res = await fetch("/me");
      const data = await res.json();
      if (data.user) {
        const subRes = await fetch("/api/user/subscription");
        const subData = await subRes.json();
        if (subData.isActive) {
          window.location.href = "/ui";
        } else {
          window.location.href = "/subscription";
        }
      }
    } catch (e) {
      // Not logged in, that's fine
    }
  }

  function init() {
    console.log("Signup form initializing...");

    // Set up event listeners
    const emailEl = $("email");
    const displayNameEl = $("displayName");
    const btn = $("subscribeBtn");

    if (emailEl) {
      emailEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          startCheckout();
        }
      });
    }

    if (displayNameEl) {
      displayNameEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          startCheckout();
        }
      });
    }

    // Set up plan card clicks
    document.querySelectorAll(".plan-card").forEach(card => {
      card.addEventListener("click", () => {
        const plan = card.dataset.plan;
        if (plan) selectPlan(plan);
      });
    });

    // Set up button click
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        startCheckout();
      });
    }

    // Initialize
    checkSession();
    checkReferralCode();
    selectPlan("user");

    console.log("Signup form initialized");
  }

  // Make functions available globally for onclick handlers
  window.selectPlan = selectPlan;
  window.startCheckout = startCheckout;

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
