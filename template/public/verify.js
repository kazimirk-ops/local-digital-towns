(function(){
  const $ = id => document.getElementById(id);
  $('verifyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = $('fullName').value.trim();
    const email = $('email').value.trim();
    const address = $('address').value.trim();
    const city = $('city').value.trim();
    const phone = $('phone').value.trim();
    if (!fullName || !email || !address || !city) {
      $('errorMsg').textContent = 'Please fill in all required fields.';
      $('errorMsg').style.display = 'block';
      return;
    }
    $('submitBtn').disabled = true;
    $('submitBtn').textContent = 'Verifying...';
    $('errorMsg').style.display = 'none';
    try {
      const res = await fetch('/api/verify/buyer', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password: $('password').value, address, city, phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      $('successMsg').style.display = 'block';
      $('verifyForm').style.display = 'none';
    } catch (err) {
      $('errorMsg').textContent = err.message;
      $('errorMsg').style.display = 'block';
      $('submitBtn').disabled = false;
      $('submitBtn').textContent = 'Verify My Account';
    }
  });
})();
