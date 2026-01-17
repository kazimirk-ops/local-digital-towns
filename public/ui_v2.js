(() => {
  function syncThemeClass() {
    document.documentElement.setAttribute("data-theme-mode", "light");
    document.body.classList.add("theme-light");
    document.body.classList.remove("theme-dark");
  }

  function bindToggle() {
    const btn = document.getElementById("themeToggleBtn");
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = "Light";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      syncThemeClass();
      bindToggle();
    });
  } else {
    syncThemeClass();
    bindToggle();
  }
})();
