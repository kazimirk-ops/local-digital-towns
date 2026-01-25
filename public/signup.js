// Signup page JavaScript - Multi-step flow
(function() {
  const $ = (id) => document.getElementById(id);

  let selectedPlan = null;
  let referralCode = null;
  let currentStep = 1;

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

  function updateStepIndicator() {
    $("dot1").className = currentStep >= 1 ? (currentStep > 1 ? "step-dot completed" : "step-dot active") : "step-dot";
    $("dot2").className = currentStep >= 2 ? (currentStep > 2 ? "step-dot completed" : "step-dot active") : "step-dot";
    $("dot3").className = currentStep >= 3 ? "step-dot active" : "step-dot";
  }

  function showStep(step) {
    currentStep = step;
    $("step1").classList.remove("active");
    $("step2user").classList.remove("active");
    $("step2business").classList.remove("active");
    $("step3").classList.remove("active");

    if (step === 1) {
      $("step1").classList.add("active");
    } else if (step === 2) {
      if (selectedPlan === "user") {
        $("step2user").classList.add("active");
      } else {
        $("step2business").classList.add("active");
      }
    } else if (step === 3) {
      $("step3").classList.add("active");
    }

    updateStepIndicator();
    showError("");
  }

  function selectPlan(plan) {
    selectedPlan = plan;
    document.querySelectorAll(".plan-card").forEach(card => {
      card.classList.toggle("selected", card.dataset.plan === plan);
    });
    const btn = $("continueBtn");
    if (btn) {
      btn.disabled = false;
      btn.textContent = plan === "business" ? "Continue with Business Plan" : "Continue with User Plan";
    }
  }

  function goToStep1() {
    showStep(1);
  }

  function goToStep2() {
    if (!selectedPlan) {
      showError("Please select a plan first.");
      return;
    }
    showStep(2);
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

  function validateUserForm() {
    const name = ($("userName")?.value || "").trim();
    const email = ($("userEmail")?.value || "").trim().toLowerCase();
    const terms = $("userTerms")?.checked;

    if (!name) {
      showError("Please enter your display name.");
      $("userName")?.focus();
      return null;
    }
    if (!email || !email.includes("@")) {
      showError("Please enter a valid email address.");
      $("userEmail")?.focus();
      return null;
    }
    if (!terms) {
      showError("Please agree to the Terms of Service.");
      return null;
    }

    // Collect interests
    const interests = [];
    if ($("interestBuying")?.checked) interests.push("buying");
    if ($("interestSelling")?.checked) interests.push("selling");
    if ($("interestGiveaways")?.checked) interests.push("giveaways");
    if ($("interestCommunity")?.checked) interests.push("community");

    return {
      displayName: name,
      email: email,
      phone: ($("userPhone")?.value || "").trim(),
      interests: interests,
      inSebastian: $("userInSebastian")?.value || "yes"
    };
  }

  function validateBusinessForm() {
    const contactName = ($("bizContactName")?.value || "").trim();
    const email = ($("bizEmail")?.value || "").trim().toLowerCase();
    const bizName = ($("bizName")?.value || "").trim();
    const bizType = ($("bizType")?.value || "").trim();
    const bizCategory = ($("bizCategory")?.value || "").trim();
    const inSebastian = ($("bizInSebastian")?.value || "").trim();
    const terms = $("bizTerms")?.checked;

    if (!contactName) {
      showError("Please enter your contact name.");
      $("bizContactName")?.focus();
      return null;
    }
    if (!email || !email.includes("@")) {
      showError("Please enter a valid email address.");
      $("bizEmail")?.focus();
      return null;
    }
    if (!bizName) {
      showError("Please enter your business name.");
      $("bizName")?.focus();
      return null;
    }
    if (!bizType) {
      showError("Please select a business type.");
      $("bizType")?.focus();
      return null;
    }
    if (!bizCategory) {
      showError("Please enter a category.");
      $("bizCategory")?.focus();
      return null;
    }
    if (!inSebastian) {
      showError("Please indicate if you're located in Sebastian.");
      $("bizInSebastian")?.focus();
      return null;
    }
    if (!terms) {
      showError("Please agree to the Terms of Service.");
      return null;
    }

    return {
      displayName: contactName,
      email: email,
      phone: ($("bizPhone")?.value || "").trim(),
      businessName: bizName,
      businessType: bizType,
      businessCategory: bizCategory,
      businessWebsite: ($("bizWebsite")?.value || "").trim(),
      businessAddress: ($("bizAddress")?.value || "").trim(),
      inSebastian: inSebastian
    };
  }

  async function startCheckout() {
    console.log("startCheckout called, plan:", selectedPlan);
    showError("");
    showSuccess("");

    // Validate form based on plan
    let formData;
    if (selectedPlan === "user") {
      formData = validateUserForm();
    } else {
      formData = validateBusinessForm();
    }

    if (!formData) return;

    // Show processing step
    showStep(3);

    const checkoutBtn = selectedPlan === "user" ? $("userCheckoutBtn") : $("bizCheckoutBtn");
    if (checkoutBtn) {
      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "Processing...";
    }

    try {
      console.log("Calling /api/signup/checkout with:", { ...formData, plan: selectedPlan });

      const res = await fetch("/api/signup/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          displayName: formData.displayName,
          phone: formData.phone || "",
          plan: selectedPlan,
          referralCode: referralCode || null,
          // User-specific fields
          interests: formData.interests || [],
          inSebastian: formData.inSebastian || "yes",
          // Business-specific fields
          businessName: formData.businessName || "",
          businessType: formData.businessType || "",
          businessCategory: formData.businessCategory || "",
          businessWebsite: formData.businessWebsite || "",
          businessAddress: formData.businessAddress || ""
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
      showStep(2); // Go back to form
      if (checkoutBtn) {
        checkoutBtn.disabled = false;
        checkoutBtn.textContent = "Start 7-Day Free Trial";
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

    try {
      // Set up plan card clicks
      document.querySelectorAll(".plan-card").forEach(card => {
        card.addEventListener("click", () => {
          console.log("Plan card clicked:", card.dataset.plan);
          const plan = card.dataset.plan;
          if (plan) selectPlan(plan);
        });
      });

    // Set up enter key handlers for form fields
    ["userName", "userEmail", "userPhone"].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            startCheckout();
          }
        });
      }
    });

    ["bizContactName", "bizEmail", "bizPhone", "bizName", "bizCategory", "bizWebsite", "bizAddress"].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            startCheckout();
          }
        });
      }
    });

    // Set up button click handlers
    const continueBtn = $("continueBtn");
    if (continueBtn) {
      continueBtn.addEventListener("click", (e) => {
        e.preventDefault();
        goToStep2();
      });
    }

    const userCheckoutBtn = $("userCheckoutBtn");
    if (userCheckoutBtn) {
      userCheckoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        startCheckout();
      });
    }

    const bizCheckoutBtn = $("bizCheckoutBtn");
    if (bizCheckoutBtn) {
      bizCheckoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        startCheckout();
      });
    }

    const userBackBtn = $("userBackBtn");
    if (userBackBtn) {
      userBackBtn.addEventListener("click", (e) => {
        e.preventDefault();
        goToStep1();
      });
    }

    const bizBackBtn = $("bizBackBtn");
    if (bizBackBtn) {
      bizBackBtn.addEventListener("click", (e) => {
        e.preventDefault();
        goToStep1();
      });
    }

    // Initialize
    checkSession();
    checkReferralCode();
    showStep(1);

    console.log("Signup form initialized");
    } catch(err) {
      console.error("Signup init error:", err);
    }
  }

  // Make functions available globally for onclick handlers
  window.selectPlan = selectPlan;
  window.goToStep1 = goToStep1;
  window.goToStep2 = goToStep2;
  window.startCheckout = startCheckout;

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
