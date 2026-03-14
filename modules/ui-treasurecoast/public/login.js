// Login page - email code + social auth
(function() {
  var $ = function(id) { return document.getElementById(id); };
  var currentEmail = "";

  function showError(msg) {
    var el = $("errorMsg");
    var success = $("successMsg");
    if (success) success.style.display = "none";
    if (el) { el.textContent = msg; el.style.display = msg ? "block" : "none"; }
  }

  function showSuccess(msg) {
    var el = $("successMsg");
    var error = $("errorMsg");
    if (error) error.style.display = "none";
    if (el) { el.textContent = msg; el.style.display = msg ? "block" : "none"; }
  }

  function showStep(step) {
    $("stepEmail").classList.toggle("active", step === "email");
    $("stepCode").classList.toggle("active", step === "code");
  }

  function sendCode() {
    showError(""); showSuccess("");
    var emailEl = $("email");
    var email = (emailEl ? emailEl.value : "").trim().toLowerCase();
    if (!email || email.indexOf("@") === -1) { showError("Please enter a valid email address."); return; }

    var btn = $("sendCodeBtn");
    btn.disabled = true;
    btn.textContent = "Sending...";

    fetch("/api/auth/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email })
    })
    .then(function(resp) {
      return resp.json().then(function(result) { return { ok: resp.ok, data: result }; });
    })
    .then(function(r) {
      if (!r.ok) {
        showError(r.data.error || "Failed to send code. Please try again.");
        btn.disabled = false;
        btn.textContent = "Send Code";
        return;
      }
      currentEmail = email;
      $("sentToEmail").textContent = email;
      showStep("code");
      showSuccess("Code sent! Check your email.");
      $("code").focus();
      btn.disabled = false;
      btn.textContent = "Send Code";
    })
    .catch(function() {
      showError("Network error. Please try again.");
      btn.disabled = false;
      btn.textContent = "Send Code";
    });
  }

  function verifyCode() {
    showError(""); showSuccess("");
    var codeEl = $("code");
    var code = (codeEl ? codeEl.value : "").trim();
    if (!code || code.length !== 6) { showError("Please enter the 6-digit code."); return; }

    var btn = $("verifyCodeBtn");
    btn.disabled = true;
    btn.textContent = "Verifying...";

    fetch("/api/auth/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: currentEmail, code: code })
    })
    .then(function(resp) {
      return resp.json().then(function(result) { return { ok: resp.ok, data: result }; });
    })
    .then(function(r) {
      if (!r.ok) {
        showError(r.data.error || "Invalid code. Please try again.");
        btn.disabled = false;
        btn.textContent = "Verify Code";
        return;
      }
      if (r.data.token) {
        localStorage.setItem("tc_token", r.data.token);
      }
      window.location.href = "/";
    })
    .catch(function() {
      showError("Network error. Please try again.");
      btn.disabled = false;
      btn.textContent = "Verify Code";
    });
  }

  function resendCode() {
    showError(""); showSuccess("");
    if (!currentEmail) { showStep("email"); return; }

    fetch("/api/auth/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: currentEmail })
    })
    .then(function(resp) {
      return resp.json().then(function(result) { return { ok: resp.ok, data: result }; });
    })
    .then(function(r) {
      if (!r.ok) { showError(r.data.error || "Failed to resend code."); return; }
      showSuccess("New code sent! Check your email.");
      $("code").value = "";
      $("code").focus();
    })
    .catch(function() {
      showError("Network error. Please try again.");
    });
  }

  function init() {
    // Check for error in URL (from Google callback failures)
    var params = new URLSearchParams(window.location.search);
    var error = params.get("error");
    if (error) {
      var msgs = {
        no_code: "Google login failed. Please try again.",
        token_failed: "Google login failed. Please try again.",
        no_email: "Could not get email from Google. Please try email login.",
        auth_failed: "Login failed. Please try again."
      };
      showError(msgs[error] || "Login failed. Please try again.");
      window.history.replaceState({}, "", "/login");
    }

    $("sendCodeBtn").addEventListener("click", function(e) { e.preventDefault(); sendCode(); });
    $("verifyCodeBtn").addEventListener("click", function(e) { e.preventDefault(); verifyCode(); });
    $("resendLink").addEventListener("click", function(e) { e.preventDefault(); resendCode(); });

    $("email").addEventListener("keydown", function(e) {
      if (e.key === "Enter") { e.preventDefault(); sendCode(); }
    });

    $("code").addEventListener("keydown", function(e) {
      if (e.key === "Enter") { e.preventDefault(); verifyCode(); }
    });

    $("code").addEventListener("input", function(e) {
      var val = e.target.value.replace(/\D/g, "").slice(0, 6);
      e.target.value = val;
      if (val.length === 6) verifyCode();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
