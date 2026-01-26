// Login page - email code authentication
(function() {
  const $ = (id) => document.getElementById(id);

  let currentEmail = "";

  function showError(msg) {
    const el = $("errorMsg");
    const success = $("successMsg");
    if (success) success.style.display = "none";
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? "block" : "none";
    }
  }

  function showSuccess(msg) {
    const el = $("successMsg");
    const error = $("errorMsg");
    if (error) error.style.display = "none";
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? "block" : "none";
    }
  }

  function showStep(step) {
    $("stepEmail").classList.toggle("active", step === "email");
    $("stepCode").classList.toggle("active", step === "code");
  }

  async function sendCode() {
    showError("");
    showSuccess("");

    const email = ($("email")?.value || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      showError("Please enter a valid email address.");
      return;
    }

    try {
      $("sendCodeBtn").disabled = true;
      $("sendCodeBtn").textContent = "Sending...";

      const resp = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });

      const result = await resp.json();

      if (!resp.ok) {
        showError(result.error || "Failed to send code. Please try again.");
        $("sendCodeBtn").disabled = false;
        $("sendCodeBtn").textContent = "Send Code";
        return;
      }

      currentEmail = email;
      $("sentToEmail").textContent = email;
      showStep("code");
      showSuccess("Code sent! Check your email.");
      $("code").focus();

    } catch (err) {
      showError("Network error. Please try again.");
    } finally {
      $("sendCodeBtn").disabled = false;
      $("sendCodeBtn").textContent = "Send Code";
    }
  }

  async function verifyCode() {
    showError("");
    showSuccess("");

    const code = ($("code")?.value || "").trim();

    if (!code || code.length !== 6) {
      showError("Please enter the 6-digit code.");
      return;
    }

    try {
      $("verifyCodeBtn").disabled = true;
      $("verifyCodeBtn").textContent = "Verifying...";

      const resp = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentEmail, code })
      });

      const result = await resp.json();

      if (!resp.ok) {
        showError(result.error || "Invalid code. Please try again.");
        $("verifyCodeBtn").disabled = false;
        $("verifyCodeBtn").textContent = "Verify Code";
        return;
      }

      // Success - redirect to home
      window.location.href = "/";

    } catch (err) {
      showError("Network error. Please try again.");
      $("verifyCodeBtn").disabled = false;
      $("verifyCodeBtn").textContent = "Verify Code";
    }
  }

  async function resendCode() {
    showError("");
    showSuccess("");

    if (!currentEmail) {
      showStep("email");
      return;
    }

    try {
      const resp = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: currentEmail })
      });

      const result = await resp.json();

      if (!resp.ok) {
        showError(result.error || "Failed to resend code.");
        return;
      }

      showSuccess("New code sent! Check your email.");
      $("code").value = "";
      $("code").focus();

    } catch (err) {
      showError("Network error. Please try again.");
    }
  }

  function init() {
    // Send code button
    $("sendCodeBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      sendCode();
    });

    // Verify code button
    $("verifyCodeBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      verifyCode();
    });

    // Resend link
    $("resendLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      resendCode();
    });

    // Enter key on email field
    $("email")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendCode();
      }
    });

    // Enter key on code field
    $("code")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        verifyCode();
      }
    });

    // Auto-submit when 6 digits entered
    $("code")?.addEventListener("input", (e) => {
      const val = e.target.value.replace(/\D/g, "").slice(0, 6);
      e.target.value = val;
      if (val.length === 6) {
        verifyCode();
      }
    });

    console.log("Login page initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
