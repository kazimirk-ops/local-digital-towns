const form = document.getElementById("residentForm");
const msg = document.getElementById("residentMsg");

if(form){
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const termsCheckbox = document.getElementById("residentTermsAccepted");
    if(!termsCheckbox || !termsCheckbox.checked){
      msg.textContent = "You must agree to the Terms of Service and Privacy Policy.";
      return;
    }
    msg.textContent = "Submitting...";
    const payload = {
      name: document.getElementById("residentName").value.trim(),
      email: document.getElementById("residentEmail").value.trim(),
      phone: document.getElementById("residentPhone").value.trim(),
      addressLine1: document.getElementById("residentAddress").value.trim(),
      city: document.getElementById("residentCity").value.trim(),
      state: document.getElementById("residentState").value.trim(),
      zip: document.getElementById("residentZip").value.trim(),
      yearsInTown: document.getElementById("residentYears").value.trim(),
      notes: document.getElementById("residentNotes").value.trim(),
      termsAcceptedAt: new Date().toISOString()
    };
    try{
      const res = await fetch("/api/public/apply/resident", {
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
