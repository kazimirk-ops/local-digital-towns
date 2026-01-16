const $ = (id) => document.getElementById(id);
const roomId = location.pathname.split("/").pop();
let channelId = null;
let pendingImageUrl = "";

async function api(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  let data; try{ data = JSON.parse(text); }catch{ data = text; }
  if(!res.ok) throw new Error(`${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function loadRoom(){
  const room = await api(`/api/live/rooms/${roomId}`);
  $("liveTitle").textContent = room.title || "Live Room";
  $("liveDesc").textContent = room.description || "";
  $("liveStatus").textContent = room.status === "live" ? "LIVE" : room.status.toUpperCase();
  channelId = room.hostChannelId;
  if(room.pinnedListing){
    $("livePinnedCard").style.display = "block";
    $("pinnedTitle").textContent = room.pinnedListing.title || "";
    $("pinnedDesc").textContent = room.pinnedListing.description || "";
    $("pinnedLink").href = `/store/${room.pinnedListing.placeId}`;
  }
  const context = room.host?.type === "place"
    ? `Live from ${room.host?.placeName || "store"}`
    : room.host?.type === "event"
      ? `${room.host?.eventTitle || "Event"} • ${room.host?.eventStartAt || ""}`
      : `Live Session by ${room.host?.displayName || "Host"}`;
  $("liveContext").textContent = context;
  const note = room.calls?.configured
    ? "Calls config detected. If the SDK is loaded, the stream will appear here."
    : "Calls not configured. Mock mode enabled.";
  $("liveCallsNote").textContent = note;
}

async function loadMessages(){
  if(!channelId) return;
  const msgs = await api(`/channels/${channelId}/messages`);
  const list = $("chatList");
  list.innerHTML = "";
  msgs.forEach(m=>{
    const div = document.createElement("div");
    div.className = "item";
    const img = m.imageUrl ? `<a href="${m.imageUrl}" target="_blank" rel="noopener"><img src="${m.imageUrl}" style="max-width:240px;border-radius:10px;border:1px solid rgba(255,255,255,.12);margin-top:6px;" /></a>` : "";
    div.innerHTML = `<div>${m.text || ""}</div>${img}<div class="muted">${m.user?.displayName || "User"} • ${m.createdAt}</div>`;
    list.appendChild(div);
  });
}

async function sendMessage(){
  if(!channelId) return alert("Chat not ready");
  const text = $("chatInput").value.trim();
  const imageUrl = pendingImageUrl || "";
  if(!text && !imageUrl) return;
  await api(`/channels/${channelId}/messages`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ text, imageUrl })
  });
  $("chatInput").value = "";
  pendingImageUrl = "";
  $("chatImagePreview").style.display = "none";
  await loadMessages();
}

function bindUpload(){
  const input = $("chatImageInput");
  const btn = $("chatUploadBtn");
  const clear = $("chatImageClear");
  const preview = $("chatImagePreview");
  const thumb = $("chatImageThumb");
  btn.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files?.[0];
    if(!file) return;
    if(!["image/png","image/jpeg","image/webp"].includes(file.type)) return alert("PNG/JPG/WebP only.");
    if(file.size > 5 * 1024 * 1024) return alert("Max 5MB.");
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "chat_image");
    const res = await api("/api/uploads", { method:"POST", body: form });
    pendingImageUrl = res.url;
    thumb.src = res.url;
    preview.style.display = "block";
    input.value = "";
  };
  clear.onclick = () => {
    pendingImageUrl = "";
    preview.style.display = "none";
    thumb.src = "";
  };
}

(async()=>{
  await loadRoom();
  await loadMessages();
  bindUpload();
  $("chatSendBtn").onclick = () => sendMessage().catch(e=>alert(e.message));
  setInterval(loadMessages, 5000);
})();
