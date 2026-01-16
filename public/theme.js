(() => {
  const STORAGE_PREFIX = "themeMode:";
  const state = {
    town: "sebastian",
    theme: null,
    mode: "dark",
    loading: null
  };

  function getTownSlug(){
    return (document.body?.dataset?.town || "sebastian").toLowerCase();
  }

  function normalizeTheme(raw){
    const theme = raw || {};
    const modes = theme.modes || {};
    const fallback = theme.colors || {};
    if(!modes.dark) modes.dark = fallback;
    if(!modes.light) modes.light = fallback;
    return { ...theme, modes };
  }

  function applyThemeVariables(colors, fonts, ui, background){
    if(!colors) return;
    const root = document.documentElement;
    if(colors.bg) root.style.setProperty("--bg", colors.bg);
    if(colors.panel) root.style.setProperty("--panel", colors.panel);
    if(colors.panel2){
      root.style.setProperty("--panel-2", colors.panel2);
      root.style.setProperty("--panel2", colors.panel2);
    }
    if(colors.text) root.style.setProperty("--text", colors.text);
    if(colors.muted) root.style.setProperty("--muted", colors.muted);
    if(colors.accent) root.style.setProperty("--accent", colors.accent);
    if(colors.accent2){
      root.style.setProperty("--accent-2", colors.accent2);
      root.style.setProperty("--accent2", colors.accent2);
    }
    if(colors.border) root.style.setProperty("--border", colors.border);
    if(colors.card) root.style.setProperty("--card", colors.card);
    if(colors.sidebar) root.style.setProperty("--sidebar", colors.sidebar);
    if(colors.rail) root.style.setProperty("--rail", colors.rail);
    if(fonts?.body) root.style.setProperty("--font-sans", `"${fonts.body}", ui-sans-serif, system-ui`);
    if(fonts?.display) root.style.setProperty("--font-display", `"${fonts.display}", ui-sans-serif, system-ui`);
    if(ui?.radius){
      if(ui.radius.sm) root.style.setProperty("--radius-sm", ui.radius.sm);
      if(ui.radius.md) root.style.setProperty("--radius", ui.radius.md);
      if(ui.radius.lg) root.style.setProperty("--radius-lg", ui.radius.lg);
      if(ui.radius.pill) root.style.setProperty("--radius-pill", ui.radius.pill);
    }
    if(ui?.shadow){
      if(ui.shadow.sm) root.style.setProperty("--shadow-sm", ui.shadow.sm);
      if(ui.shadow.md) root.style.setProperty("--shadow", ui.shadow.md);
      if(ui.shadow.lg) root.style.setProperty("--shadow-lg", ui.shadow.lg);
    }
    if(ui?.borderWidth) root.style.setProperty("--border-width", ui.borderWidth);
    if(ui?.blurStrength) root.style.setProperty("--blur-strength", ui.blurStrength);
    if(background?.heroImageUrl) root.style.setProperty("--hero-image-url", `url("${background.heroImageUrl}")`);
  }

  function getStoredMode(town){
    try{
      const stored = localStorage.getItem(`${STORAGE_PREFIX}${town}`);
      if(stored === "dark" || stored === "light") return stored;
    }catch{}
    return null;
  }

  function updateToggleLabel(){
    const btn = document.getElementById("themeToggleBtn");
    if(!btn) return;
    const label = state.mode === "dark" ? "Dark" : "Light";
    btn.textContent = `Dark / Light: ${label}`;
  }

  function applyMode(mode){
    if(!state.theme) return;
    const modeCfg = state.theme.modes?.[mode] || {};
    const colors = modeCfg.colors || state.theme.colors || modeCfg || {};
    applyThemeVariables(colors, state.theme.fonts || {}, state.theme.ui || {}, state.theme.background || {});
    document.documentElement.setAttribute("data-theme-mode", mode);
    state.mode = mode;
    updateToggleLabel();
  }

  function setMode(mode){
    if(mode !== "dark" && mode !== "light") return;
    applyMode(mode);
    try{
      localStorage.setItem(`${STORAGE_PREFIX}${state.town}`, mode);
    }catch{}
  }

  function toggleMode(){
    const next = state.mode === "dark" ? "light" : "dark";
    setMode(next);
  }

  async function loadTownTheme(){
    if(state.loading) return state.loading;
    state.loading = (async()=>{
      const town = getTownSlug();
      state.town = town;
      let raw = null;
      try{
        const res = await fetch(`/themes/${town}.json`);
        if(res.ok) raw = await res.json();
      }catch{}
      state.theme = normalizeTheme(raw || {});
      const stored = getStoredMode(town);
      const defaultMode = state.theme.defaultMode === "light" ? "light" : "dark";
      applyMode(stored || defaultMode);
      const isDev = location.hostname === "localhost" || location.hostname === "127.0.0.1";
      if(isDev){
        console.log(`Theme applied: ${state.town} / ${state.mode}`);
      }
      const btn = document.getElementById("themeToggleBtn");
      if(btn){
        btn.onclick = toggleMode;
        updateToggleLabel();
      }
      return state;
    })();
    return state.loading;
  }

  window.loadTownTheme = loadTownTheme;
  window.setTownThemeMode = setMode;
  window.toggleTownThemeMode = toggleMode;

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", () => { loadTownTheme(); });
  }else{
    loadTownTheme();
  }
})();
