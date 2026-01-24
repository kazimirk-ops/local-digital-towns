async function api(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function pill(text) {
  const span = document.createElement("span");
  span.className = "pill";
  span.textContent = text;
  return span;
}

async function loadProfile() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const userId = parts[1];
  if (!userId) return;
  const profile = await api(`/api/users/${userId}`);

  document.getElementById("profileName").textContent = profile.displayName || "Profile";

  const avatar = document.getElementById("avatarImg");
  if (profile.avatarUrl) {
    avatar.src = profile.avatarUrl;
  } else {
    avatar.style.display = "none";
  }

  const badges = document.getElementById("profileBadges");
  badges.innerHTML = "";
  if (profile.isBuyerVerified) badges.appendChild(pill("Buyer Verified"));
  if (profile.isSellerVerified) badges.appendChild(pill("Seller Verified"));
  if (profile.isBuyer) badges.appendChild(pill("buyer"));
  if (profile.isSeller) badges.appendChild(pill("seller"));

  const trust = document.getElementById("profileTrustTier");
  if (profile.trustTierLabel) {
    trust.textContent = `Trust Tier: ${profile.trustTierLabel}`;
  } else if (Number.isFinite(profile.trustTier)) {
    trust.textContent = `Trust Tier: ${profile.trustTier}`;
  } else {
    trust.textContent = "";
  }

  const bio = document.getElementById("profileBio");
  bio.textContent = profile.bio || "";
  if (!profile.bio) bio.style.display = "none";

  const age = document.getElementById("profileAgeRange");
  age.textContent = profile.ageRange ? `Age range: ${profile.ageRange}` : "";
  if (!profile.ageRange) age.style.display = "none";

  const interests = document.getElementById("profileInterests");
  interests.innerHTML = "";
  if (Array.isArray(profile.interests)) {
    profile.interests.forEach((t) => interests.appendChild(pill(t)));
  }

  const reviews = document.getElementById("profileReviews");
  if (profile.reviews?.count) {
    reviews.textContent = `Reviews: ${profile.reviews.count} • Avg ${profile.reviews.average.toFixed(1)}`;
  } else {
    reviews.style.display = "none";
  }

  // Load ghosting stats
  const ghostingEl = document.getElementById("profileGhosting");
  try {
    const ghostStats = await api(`/api/users/${userId}/ghosting`);
    if (ghostStats && ghostStats.totalOrders > 0) {
      ghostingEl.style.display = "block";
      const pct = ghostStats.ghostingPercent || 0;
      let color = "#94a3b8"; // gray
      if (pct >= 20) color = "#f87171"; // red
      else if (pct >= 10) color = "#fbbf24"; // yellow
      ghostingEl.innerHTML = `Buyer Reliability: <span style="color:${color}; font-weight:600;">${pct.toFixed(1)}% non-payment rate</span> (${ghostStats.ghostCount} of ${ghostStats.totalOrders} orders)`;
    }
  } catch(e) {
    // Ghosting stats not available, hide
  }

  const me = await api("/me");
  const btn = document.getElementById("messageBtn");
  if (me?.user) {
    btn.disabled = false;
    btn.onclick = async () => {
      const convo = await api("/dm/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherUserId: Number(userId) }),
      });
      window.location.href = `/me/profile#dm=${convo.id}`;
    };
  }
}

loadProfile().catch((e) => {
  document.getElementById("profileError").textContent = e.message;
});
