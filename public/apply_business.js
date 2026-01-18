const form = document.getElementById("businessForm");
const msg = document.getElementById("businessMsg");

if(form){
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    msg.textContent = "Submitting...";
    const payload = {
      contactName: document.getElementById("businessContactName").value.trim(),
      email: document.getElementById("businessEmail").value.trim(),
      phone: document.getElementById("businessPhone").value.trim(),
      businessName: document.getElementById("businessName").value.trim(),
      type: document.getElementById("businessType").value.trim(),
      category: document.getElementById("businessCategory").value.trim(),
      website: document.getElementById("businessWebsite").value.trim(),
      inSebastian: document.getElementById("businessInSebastian").value.trim(),
      address: document.getElementById("businessAddress").value.trim(),
      notes: document.getElementById("businessNotes").value.trim()
    };
    try{
      const res = await fetch("/api/public/apply/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok){
        msg.textContent = data.error || "Submission failed.";
        return;
      }
      msg.textContent = "Application submitted. We'll be in touch.";
      form.reset();
    }catch(err){
      msg.textContent = "Submission failed.";
    }
  });
}
