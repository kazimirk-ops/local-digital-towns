(function(){
  const $ = id => document.getElementById(id);
  function formatCurrency(cents) { return '$' + (Number(cents || 0) / 100).toFixed(2); }
  function formatDate(dateStr) { return dateStr ? new Date(dateStr).toLocaleString() : '—'; }
  function getStatusClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'completed') return 'completed';
    if (s === 'ghosted') return 'ghosted';
    return 'pending';
  }
  async function loadOrder() {
    const orderId = window.location.pathname.split('/').pop();
    if (!orderId || orderId === 'orders') return;
    try {
      const res = await fetch(`/api/orders/${orderId}/detail`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      renderOrder(await res.json());
    } catch (e) {
      document.body.innerHTML = `<p style="padding:40px;text-align:center;color:#f87171;">Error: ${e.message}</p>`;
    }
  }
  function renderOrder(data) {
    const { order, items, buyer, seller, place } = data;
    $('orderId').textContent = order.id;
    $('orderStatus').textContent = order.status || 'pending';
    $('orderStatus').className = 'badge ' + getStatusClass(order.status);
    $('orderDate').textContent = formatDate(order.createdAt);
    $('buyerName').textContent = buyer?.displayName || buyer?.email || `User #${order.buyerUserId}`;
    $('sellerName').textContent = seller?.displayName || seller?.email || `User #${order.sellerUserId}`;
    $('storeName').textContent = place?.name || '—';
    $('orderTotal').textContent = formatCurrency(order.totalCents);
    const itemsList = $('itemsList');
    if (items && items.length) {
      itemsList.innerHTML = items.map(item => `
        <div class="item-row">
          <span>${item.title || 'Item'} × ${item.quantity || 1}</span>
          <span>${formatCurrency(item.priceCents * (item.quantity || 1))}</span>
        </div>
      `).join('');
    } else {
      itemsList.innerHTML = '<p style="color:#64748b;">No items</p>';
    }
  }
  loadOrder();
})();
