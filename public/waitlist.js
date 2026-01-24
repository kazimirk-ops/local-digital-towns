const form = document.getElementById("waitlistForm");
const msg = document.getElementById("waitlistMsg");

if(form){
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const termsCheckbox = document.getElementById("waitlistTermsAccepted");
    if(!termsCheckbox || !termsCheckbox.checked){
      msg.textContent = "You must agree to the Terms of Service and Privacy Policy.";
      return;
    }
    msg.textContent = "Submitting...";
    const interests = Array.from(document.querySelectorAll("input[name='interest']:checked"))
      .map((el)=>el.value);
    const payload = {
      email: document.getElementById("waitlistEmail").value.trim(),
      name: document.getElementById("waitlistName").value.trim(),
      phone: document.getElementById("waitlistPhone").value.trim(),
      interests,
      notes: document.getElementById("waitlistNotes").value.trim(),
      termsAcceptedAt: new Date().toISOString()
    };
    try{
      const res = await fetch("/api/public/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok){
        msg.textContent = data.error || "Submission failed.";
        return;
      }
      msg.textContent = "Thanks! You're on the list.";
      form.reset();
    }catch(err){
      msg.textContent = "Submission failed.";
    }
  });
}
