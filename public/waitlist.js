const form = document.getElementById("waitlistForm");
const msg = document.getElementById("waitlistMsg");

if(form){
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    msg.textContent = "Submitting...";
    const interests = Array.from(document.querySelectorAll("input[name='interest']:checked"))
      .map((el)=>el.value);
    const payload = {
      email: document.getElementById("waitlistEmail").value.trim(),
      name: document.getElementById("waitlistName").value.trim(),
      phone: document.getElementById("waitlistPhone").value.trim(),
      interests,
      notes: document.getElementById("waitlistNotes").value.trim()
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
