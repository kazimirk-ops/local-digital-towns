async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

let currentUserId = null;
let currentConversationId = null;
let townCtx = { trustTier:0, tierName:"Visitor", permissions:{} };

function setMsg(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function updateHeroPreview() {
  const name = document.getElementById("displayName")?.value || "";
  const bio = document.getElementById("bio")?.value || "";
  const heroName = document.querySelector(".hero-title");
  const heroBio = document.getElementById("heroBio");
  if (heroName) heroName.textContent = name.trim() || "Your Name";
  if (heroBio) heroBio.textContent = bio.trim() || "Add a bio to tell others about yourself...";
}

function updateAvatarPreview() {
  const url = document.getElementById("avatarUrl")?.value || "";
  const img = document.getElementById("avatarPreview");
  if (!img) return;
  if (url.trim()) {
    img.src = url.trim();
    img.style.display = "block";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
  }
}

async function loadProfile() {
  try {
    const profile = await api("/api/me/profile");
    currentUserId = profile.id;
    document.getElementById("displayName").value = profile.displayName || "";
    document.getElementById("bio").value = profile.bio || "";
    document.getElementById("avatarUrl").value = profile.avatarUrl || "";
    document.getElementById("interests").value = (profile.interests || []).join(", ");
    document.getElementById("ageRange").value = profile.ageRange || "";
    document.getElementById("showAvatar").checked = !!profile.showAvatar;
    document.getElementById("showBio").checked = !!profile.showBio;
    document.getElementById("showInterests").checked = !!profile.showInterests;
    document.getElementById("showAgeRange").checked = !!profile.showAgeRange;
    const buyerStatus = profile.isBuyerVerified ? "Buyer status: Verified" : "Buyer status: Not verified";
    document.getElementById("buyerStatus").textContent = buyerStatus;
    setMsg("profileLoginNote", "");
    updateHeroPreview();
    updateAvatarPreview();
  } catch (e) {
    document.getElementById("profileLoginNote").textContent = "Login required to edit your profile.";
  }
}

async function loadTownContext(){
  try {
    townCtx = await api("/town/context");
  } catch {
    townCtx = { trustTier:0, tierName:"Visitor", permissions:{} };
  }
  const badge = document.getElementById("trustBadge");
  if(badge) badge.textContent = `Tier ${townCtx.trustTier || 0}: ${townCtx.tierName || townCtx.trustTierLabel || "Visitor"}`;
  applyProfilePermissions();
}

function applyProfilePermissions(){
  const perms = townCtx.permissions || {};
  const dmAllowed = !!perms.dm;
  const dmCard = document.getElementById("dmCard");
  const dmInput = document.getElementById("dmInput");
  const dmBtn = document.getElementById("dmSendBtn");
  if(dmCard) dmCard.style.display = dmAllowed ? "block" : "none";
  if(dmInput) dmInput.disabled = !dmAllowed;
  if(dmBtn) dmBtn.disabled = !dmAllowed;
  if(!dmAllowed) setMsg("dmMsg", "Tier 1+ required to use direct messages.");
}

async function saveProfile() {
  try {
    const payload = {
      displayName: document.getElementById("displayName").value.trim(),
      bio: document.getElementById("bio").value.trim(),
      avatarUrl: document.getElementById("avatarUrl").value.trim(),
      interests: document.getElementById("interests").value.split(",").map(s=>s.trim()).filter(Boolean),
      ageRange: document.getElementById("ageRange").value.trim(),
      showAvatar: document.getElementById("showAvatar").checked,
      showBio: document.getElementById("showBio").checked,
      showInterests: document.getElementById("showInterests").checked,
      showAgeRange: document.getElementById("showAgeRange").checked
    };
    await api("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setMsg("profileMsg", "Saved.");
  } catch (e) {
    setMsg("profileMsg", `ERROR: ${e.message}`);
  }
}

async function uploadAvatar() {
  const fileInput = document.getElementById("avatarFile");
  const target = document.getElementById("avatarUrl");
  if (!fileInput?.files?.length) return setMsg("profileMsg", "Select an image first.");
  const file = fileInput.files[0];
  if (!file.type.startsWith("image/")) return setMsg("profileMsg", "Images only.");
  if (file.size > 2 * 1024 * 1024) return setMsg("profileMsg", "Image too large (max 2MB).");
  const form = new FormData();
  form.append("file", file);
  form.append("kind", "profile_avatar");
  try {
    const data = await api("/api/uploads", {
      method: "POST",
      body: form
    });
    const returnedUrl = typeof data === "string" ? data : (data.url || data.avatarUrl || data.publicUrl || "");
    const avatarInput = document.getElementById("avatarUrl");
    const avatarImg = document.getElementById("avatarImg");
    if (!avatarInput || !avatarImg) {
      console.warn("Avatar preview elements missing", { avatarUrl: !!avatarInput, avatarImg: !!avatarImg });
    }
    if (avatarInput) avatarInput.value = returnedUrl;
    if (avatarImg && returnedUrl) avatarImg.src = `${returnedUrl}?v=${Date.now()}`;
    await saveProfile();
    setMsg("profileMsg", "Uploaded and saved.");
  } catch (e) {
    setMsg("profileMsg", `ERROR: ${e.message}`);
  }
}

async function loadDmList() {
  try {
    const convos = await api("/dm");
    const list = document.getElementById("dmList");
    list.innerHTML = "";
    convos.forEach((c) => {
      const div = document.createElement("div");
      const name = c.otherUser ? c.otherUser.displayName : `Conversation ${c.id}`;
      const tier = c.otherUser?.trustTierLabel ? ` • ${c.otherUser.trustTierLabel}` : "";
      div.textContent = `${name}${tier}`;
      div.addEventListener("click", () => openConversation(c.id));
      list.appendChild(div);
    });
    const hash = window.location.hash || "";
    if (hash.startsWith("#dm=")) {
      const id = hash.slice(4);
      if (id) openConversation(id);
    }
  } catch (e) {
    setMsg("dmMsg", `ERROR: ${e.message}`);
  }
}

async function loadPrizeClaims(){
  const list = document.getElementById("profilePrizeClaims");
  if(!list) return;
  list.innerHTML = "";
  const rows = await api("/api/prize_awards/my");
  if(!rows.length){
    list.innerHTML = `<div class="muted">No prize claims.</div>`;
    return;
  }
  rows.forEach((r)=>{
    const div = document.createElement("div");
    const convoLink = r.convoId ? `/me/profile#dm=${r.convoId}` : "#";
    div.innerHTML = `<div><strong>${r.title}</strong> • ${r.status}</div>
      <div class="muted">Due ${r.dueBy || "—"}</div>
      <div><a class="pill" href="${convoLink}">Open Conversation</a></div>`;
    list.appendChild(div);
  });
}

async function openConversation(id) {
  currentConversationId = id;
  const msgs = await api(`/dm/${id}/messages`);
  const list = document.getElementById("dmMessages");
  list.innerHTML = "";
  msgs.forEach((m) => {
    const div = document.createElement("div");
    const name = m.sender?.displayName || `User ${m.senderUserId}`;
    const tier = m.sender?.trustTierLabel ? ` • ${m.sender.trustTierLabel}` : "";
    div.textContent = `${name}${tier}: ${m.text}`;
    list.appendChild(div);
  });
}

async function sendDm() {
  if (!currentConversationId) return setMsg("dmMsg", "Select a conversation.");
  const text = document.getElementById("dmInput").value.trim();
  if (!text) return;
  await api(`/dm/${currentConversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  document.getElementById("dmInput").value = "";
  await openConversation(currentConversationId);
}

document.getElementById("saveProfileBtn")?.addEventListener("click", saveProfile);
document.getElementById("dmSendBtn")?.addEventListener("click", sendDm);
document.getElementById("displayName").addEventListener("input", updateHeroPreview);
document.getElementById("bio").addEventListener("input", updateHeroPreview);
document.getElementById("avatarUrl").addEventListener("input", updateAvatarPreview);
document.addEventListener("DOMContentLoaded", () => {
  const uploadBtn = document.getElementById("uploadAvatarBtn");
  const fileInput = document.getElementById("avatarFile");
  if (!uploadBtn || !fileInput) {
    console.warn("Avatar upload elements missing", { uploadBtn: !!uploadBtn, fileInput: !!fileInput });
    return;
  }
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => uploadAvatar());
});

loadTownContext().then(() => loadProfile().then(async () => {
  if (!currentUserId) return;
  await loadDmList();
  await loadPrizeClaims();
})).catch(() => {});
