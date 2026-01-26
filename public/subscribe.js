// Subscribe page - UI only (no backend calls yet)
(function() {
  const $ = (id) => document.getElementById(id);

  let selectedPlan = null;

  function showError(msg) {
    const el = $("errorMsg");
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? "block" : "none";
    }
  }

  function selectPlan(plan) {
    selectedPlan = plan;
    $("planIndividual").classList.toggle("selected", plan === "individual");
    $("planBusiness").classList.toggle("selected", plan === "business");
    $("businessFields").classList.toggle("show", plan === "business");
    validateForm();
  }

  function validateForm() {
    const email = ($("email")?.value || "").trim();
    const displayName = ($("displayName")?.value || "").trim();
    const hasEmail = email && email.includes("@");
    const hasName = displayName.length > 0;

    let valid = selectedPlan && hasEmail && hasName;

    // If business plan, require business name and type
    if (selectedPlan === "business") {
      const bizName = ($("businessName")?.value || "").trim();
      const bizType = ($("businessType")?.value || "").trim();
      valid = valid && bizName && bizType;
    }

    $("submitBtn").disabled = !valid;
  }

  function handleSubmit() {
    showError("");

    const email = ($("email")?.value || "").trim().toLowerCase();
    const displayName = ($("displayName")?.value || "").trim();
    const phone = ($("phone")?.value || "").trim();
    const referralCode = ($("referralCode")?.value || "").trim();

    if (!selectedPlan) {
      showError("Please select a plan.");
      return;
    }
    if (!email || !email.includes("@")) {
      showError("Please enter a valid email address.");
      return;
    }
    if (!displayName) {
      showError("Please enter your display name.");
      return;
    }

    const formData = {
      plan: selectedPlan,
      email: email,
      displayName: displayName,
      phone: phone,
      referralCode: referralCode
    };

    if (selectedPlan === "business") {
      formData.businessName = ($("businessName")?.value || "").trim();
      formData.businessType = ($("businessType")?.value || "").trim();
      formData.businessAddress = ($("businessAddress")?.value || "").trim();
      formData.businessWebsite = ($("businessWebsite")?.value || "").trim();

      if (!formData.businessName) {
        showError("Please enter your business name.");
        return;
      }
      if (!formData.businessType) {
        showError("Please select a business type.");
        return;
      }
    }

    console.log("Form submitted:", formData);
    // TODO: Call backend API to create Stripe checkout session
    alert("Checkout not connected yet. Form data logged to console.");
  }

  function init() {
    // Plan selection
    $("planIndividual")?.addEventListener("click", () => selectPlan("individual"));
    $("planBusiness")?.addEventListener("click", () => selectPlan("business"));

    // Referral code toggle
    $("referralToggle")?.addEventListener("click", () => {
      $("referralField").classList.toggle("show");
    });

    // Form validation on input
    ["email", "displayName", "phone", "businessName", "businessType"].forEach(id => {
      $(id)?.addEventListener("input", validateForm);
    });
    $("businessType")?.addEventListener("change", validateForm);

    // Submit button
    $("submitBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      handleSubmit();
    });

    // Enter key handling
    ["email", "displayName", "phone", "businessName", "businessAddress", "businessWebsite", "referralCode"].forEach(id => {
      $(id)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleSubmit();
        }
      });
    });

    console.log("Subscribe page initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
