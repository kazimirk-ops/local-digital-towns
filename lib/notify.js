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

  const token = (process.env.POSTMARK_SERVER_TOKEN || "").trim();
  const to = parseEmails(process.env.ADMIN_NOTIFY_EMAILS);
  const from = (process.env.EMAIL_FROM || "").trim();
  console.log("ADMIN_EMAIL_SEND_ATTEMPT", {
    to: to.map(redactEmail),
    toCount: to.length,
    hasPostmarkToken: !!token,
    hasEmailFrom: !!from,
    nodeEnv: process.env.NODE_ENV || ""
  });
  if(!token || !to.length || !from){
    console.warn("Admin email notify not configured");
    console.log("ADMIN_EMAIL_SEND_RESULT", { ok:false, statusCode: null });
    return { ok:false, skipped:true, statusCode: null };
  }

  const payload = {
    From: from,
    To: to.join(","),
    Subject: subject || "Admin notification",
    TextBody: textBody || "New admin notification."
  };
  if(htmlBody) payload.HtmlBody = htmlBody;

  try{
    const resp = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if(!resp.ok){
      const errText = await resp.text().catch(()=> "");
      console.log("ADMIN_EMAIL_SEND_RESULT", { ok:false, statusCode: resp.status });
      return { ok:false, error: errText || `Postmark error ${resp.status}`, statusCode: resp.status };
    }
    console.log("ADMIN_EMAIL_SEND_RESULT", { ok:true, statusCode: resp.status });
    return { ok:true, statusCode: resp.status };
  }catch(err){
    console.log("ADMIN_EMAIL_SEND_RESULT", { ok:false, statusCode: null });
    return { ok:false, error: err.message || String(err), statusCode: null };
  }
}

module.exports = { sendAdminEmail };
