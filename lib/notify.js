function parseEmails(raw){
  return (raw || "")
    .split(",")
    .map((e)=>e.trim())
    .filter(Boolean);
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
  if(!token || !to.length || !from){
    console.warn("Admin email notify not configured");
    return { ok:false, skipped:true };
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
      return { ok:false, error: errText || `Postmark error ${resp.status}` };
    }
    return { ok:true };
  }catch(err){
    return { ok:false, error: err.message || String(err) };
  }
}

module.exports = { sendAdminEmail };
