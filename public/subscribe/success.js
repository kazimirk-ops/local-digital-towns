// Subscribe success page
(function() {
  const $ = (id) => document.getElementById(id);

  async function checkAccountReady() {
    // Wait 2 seconds for webhook to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Hide spinner, show success
    $("spinner").classList.add("hidden");
    $("subtitle").textContent = "Your account is ready!";
    $("successMessage").classList.remove("hidden");
    $("loginBtn").classList.remove("hidden");

    // Try auto-redirect after another 2 seconds
    setTimeout(() => {
      window.location.href = "/";
    }, 2000);
  }

  checkAccountReady();
})();
