function parseEmails(raw){
  return (raw || "")
    .split(",")
    .map((e)=>e.trim())
    .filter(Boolean);
}
function redactEmail(email){
  const s = (email || "").toString().trim();
  const at = s.indexOf("@");
  if(at < 1) return s ? `${s.slice(0,3)}...` : "";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const prefix = local.slice(0, 3);
  const dots = local.length > 3 ? "..." : "";
  return `${prefix}${dots}@${domain}`;
}

async function sendAdminEmail(subjectOrPayload, text){
  let subject = "";
  let textBody = "";
  let htmlBody = "";
  if(subjectOrPayload && typeof subjectOrPayload === "object"){
    subject = (subjectOrPayload.subject || "").toString();
    textBody = (subjectOrPayload.text || "").toString();
    htmlBody = (subjectOrPayload.html || "").toString();
  }else{
    subject = (subjectOrPayload || "").toString();
    textBody = (text || "").toString();
  }

  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const to = parseEmails(process.env.ADMIN_NOTIFY_EMAILS);
  const from = (process.env.EMAIL_FROM || "").trim() || "onboarding@resend.dev";

  console.log("ADMIN_EMAIL_SEND_ATTEMPT", {
    to: to.map(redactEmail),
    toCount: to.length,
    hasResendKey: !!apiKey,
    from: redactEmail(from),
    subject
  });

  if(!apiKey || !to.length){
    console.warn("Admin email notify not configured (missing RESEND_API_KEY or ADMIN_NOTIFY_EMAILS)");
    return { ok: false, skipped: true, statusCode: null };
  }

  const payload = {
    from,
    to,
    subject: subject || "Admin notification",
    text: textBody || "New admin notification."
  };
  if(htmlBody) payload.html = htmlBody;

  try{
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if(!resp.ok){
      const errText = await resp.text().catch(() => "");
      console.error("ADMIN_EMAIL_SEND_ERROR", { statusCode: resp.status, error: errText });
      return { ok: false, error: errText || `Resend error ${resp.status}`, statusCode: resp.status };
    }

    const result = await resp.json().catch(() => ({}));
    console.log("ADMIN_EMAIL_SEND_SUCCESS", { statusCode: resp.status, id: result.id });
    return { ok: true, statusCode: resp.status, id: result.id };
  }catch(err){
    console.error("ADMIN_EMAIL_SEND_ERROR", { error: err.message || String(err) });
    return { ok: false, error: err.message || String(err), statusCode: null };
  }
}

module.exports = { sendAdminEmail };
