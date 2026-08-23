const app = document.querySelector("#app");
let token = localStorage.getItem("vf_token"),
  me = null,
  users = [];
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { error: `Server returned ${response.status} instead of JSON.` };
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};
const money = (n) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n || 0,
  );
const initials = (name) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
let livePrices = {
  BTC: { usd: 66008.36, change: 0 },
  ETH: { usd: 3506.02, change: 0 },
  USDC: { usd: 1, change: 0 },
  USDT: { usd: 1, change: 0 },
};
let priceTimer = null;
const meta = {
  BTC: ["₿", "Bitcoin", ""],
  ETH: ["◆", "Ethereum", "eth"],
  USDC: ["$", "USD Coin", "usdc"],
  USDT: ["₮", "Tether", "usdc"],
};
const receiveAddresses = {
  BTC: ["Bitcoin", "bc1qtndhsmj0p8ka2y4xqtagx0z5vl92vu0mun5kve"],
  ETH: ["Ethereum (ERC20)", "0xA985b9a974d8933CFeE908EbD6E07E9Dd6F635dC"],
  USDT: ["Tether (TRC20)", "TGFgh3tAatcrtJKu86BM7m1DkmufVAUhp9"],
  USDC: ["USD Coin (ERC20)", "0xA985b9a974d8933CFeE908EbD6E07E9Dd6F635dC"],
};
const options = Object.keys(meta)
  .map((s) => `<option value="${s}">${s} — ${meta[s][1]}</option>`)
  .join("");
const brand = `<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 3.5 27 10v12L16 28.5 5 22V10l11-6.5Z" fill="currentColor" opacity=".22"/><path d="M10 12.4 16 9l6 3.4v7.2L16 23l-6-3.4v-7.2Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 9v14M10 12.4l6 3.5 6-3.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>OnchainVault</div>`;

function landing() {
  app.innerHTML = `<section class="landing"><nav>${brand}<div class="nav-actions"><button class="outline" onclick="auth('login')">Sign in</button><button class="primary" onclick="auth('signup')">Get started</button></div></nav><div class="hero"><div><div class="eyebrow">Your assets, your flow</div><h1>Recover the next<br><em>with confidence.</em></h1><p>A considered home for your digital assets. Track live markets, manage your portfolio, and move only when you are ready.</p><div class="hero-actions"><button class="primary" onclick="auth('signup')">Create free account →</button><button class="text-button" onclick="auth('login')">View your portfolio</button></div><div class="hero-proof"><span>◉ Private account data</span><span>◉ Admin-reviewed funding</span></div></div><div class="wallet-preview"><div class="wallet-top"><span>Portfolio overview</span><span>•••</span></div><div class="wallet-value">$24,864.21</div><span class="gain">↗ 12.4% this month</span><div class="coins"><div class="coin">₿<b>Bitcoin</b><small>Live market</small></div><div class="coin">◆<b>Ethereum</b><small>Live market</small></div><div class="coin">$<b>USDC</b><small>Stable value</small></div></div></div></div><div class="landing-body"><section class="market-section"><div class="section-heading"><div><div class="eyebrow">Live market snapshot</div><h2>Markets at a glance.</h2></div><span class="market-status" id="landingMarketStatus">Updating prices…</span></div><div class="market-grid"><article class="market-card"><span class="token">₿</span><div><b>Bitcoin</b><small>BTC</small></div><strong data-market="BTC">—</strong></article><article class="market-card"><span class="token eth">◆</span><div><b>Ethereum</b><small>ETH</small></div><strong data-market="ETH">—</strong></article><article class="market-card"><span class="token usdc">$</span><div><b>USD Coin</b><small>USDC</small></div><strong data-market="USDC">—</strong></article></div></section><section class="feature-grid"><article><span>⌁</span><h3>One clear portfolio</h3><p>See your live asset values and your exact holdings without losing the signal in the noise.</p></article><article><span>✓</span><h3>Controlled deposits</h3><p>Funding requests remain pending until they are reviewed and approved in your admin workspace.</p></article><article><span>◈</span><h3>Account-level privacy</h3><p>Every dashboard and activity history belongs only to the account that created it.</p></article></section><section class="security-callout"><div><div class="eyebrow">Built with intention</div><h2>Your portfolio, in focus.</h2><p>OnchainVault keeps the practical details close: current market value, exact balances, and a transparent activity trail.</p></div><button class="primary" onclick="auth('signup')">Start your vault</button></section></div></section>`;
  loadLandingMarkets();
}
async function loadLandingMarkets() {
  try {
    const data = await api("/api/market/prices");
    document.querySelectorAll("[data-market]").forEach((element) => {
      const quote = data[element.dataset.market];
      element.textContent = `${money(quote.usd)}  ${quote.change >= 0 ? "↗" : "↘"} ${Math.abs(quote.change).toFixed(2)}%`;
    });
    const status = document.getElementById("landingMarketStatus");
    if (status)
      status.textContent = data.stale
        ? "Market data unavailable"
        : "Live prices · USD";
  } catch {
    const status = document.getElementById("landingMarketStatus");
    if (status) status.textContent = "Market snapshot unavailable";
  }
}
function auth(mode) {
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">${brand}<h1>${mode === "login" ? "Welcome back" : "Create your Vault"}</h1><p>${mode === "login" ? "Sign in to access your Vault." : "Start managing your digital assets today."}</p><div id="err"></div>${mode === "signup" ? '<label class="field">FULL NAME</label><input class="input" id="name" placeholder="Your name">' : ""}<label class="field">EMAIL ADDRESS</label><input class="input" id="email" type="email" placeholder="you@example.com"><label class="field">PASSWORD</label><input class="input" id="password" type="password" placeholder="At least 8 characters"><button class="primary wide" onclick="submitAuth('${mode}')">${mode === "login" ? "Sign in" : "Create account"}</button><div class="switch">${mode === "login" ? 'New to OnchainVault? <span class="link" onclick="auth(\'signup\')">Create an account</span>' : 'Already have an account? <span class="link" onclick="auth(\'login\')">Sign in</span>'}</div>${mode === "login" ? '<div class="demo">Private access · Admin-reviewed accounts</div>' : ""}</div></section>`;
}
async function submitAuth(mode) {
  try {
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const nameInput = document.getElementById("name");
    const body = {
      email: emailInput.value.trim(),
      password: passwordInput.value,
    };
    if (mode === "signup") body.name = nameInput.value.trim();
    const data = await api(
      `/api/auth/${mode === "login" ? "login" : "signup"}`,
      { method: "POST", body: JSON.stringify(body) },
    );
    token = data.token;
    localStorage.setItem("vf_token", token);
    me = data.user;

    app.innerHTML = `<section class="auth-shell"><div class="auth-card">${brand}<h1>Welcome back</h1><p>Preparing your dashboard...</p><div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 0 8px;">
      <div class="loading-spinner" aria-label="Loading"></div>
      <div style="font-size:0.96rem;color:#cbd5e1;">Securely signing you in…</div>
    </div><div id="err"></div></div></section>`;

    await new Promise((resolve) => setTimeout(resolve, 5000));
    dashboard();
  } catch (error) {
    const errorElement = document.getElementById("err");
    if (errorElement)
      errorElement.innerHTML = `<div class="error">${error.message}</div>`;
  }
}
function shell(body, tab = "dashboard") {
  app.innerHTML = `<div class="app-shell"><aside class="side">${brand}<div class="menu"><button class="${tab === "dashboard" ? "active" : ""}" onclick="dashboard()">◈ &nbsp; Overview</button><button class="${tab === "activity" ? "active" : ""}" onclick="activity()">⇄ &nbsp; Activity</button><button onclick="walletModal('receive')">＋ &nbsp; Add funds</button>${me.role === "admin" ? `<button class="${tab === "admin" ? "active" : ""}" onclick="admin()">♙ &nbsp; Admin Console</button>` : ""}</div><div class="side-footer"><button class="menu-btn" onclick="logout()">↪ &nbsp; Sign out</button></div></aside><section class="content">${body}</section></div>`;
}
function assetRows() {
  return me.assets
    .map((asset) => {
      const [icon, name, cls] = meta[asset.symbol] || ["•", asset.symbol, ""];
      const market = livePrices[asset.symbol];
      return `<div class="asset"><div class="asset-left"><span class="token ${cls}">${icon}</span><div><b>${name}</b><div class="small live-price" data-symbol="${asset.symbol}">Current value: ${money(market.usd)} · ${market.change.toFixed(2)}% (24h)</div><div class="small">Your balance: ${asset.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${asset.symbol}</div></div></div><b class="holding-value" data-symbol="${asset.symbol}" data-amount="${asset.amount}">${money(asset.amount * market.usd)}</b></div>`;
    })
    .join("");
}
async function refreshLivePrices() {
  try {
    const data = await api("/api/market/prices");
    livePrices = data;
    document.querySelectorAll(".live-price").forEach((element) => {
      const market = livePrices[element.dataset.symbol];
      element.textContent = `Current value: ${money(market.usd)} · ${market.change.toFixed(2)}% (24h)`;
    });
    document.querySelectorAll(".holding-value").forEach((element) => {
      element.textContent = money(
        Number(element.dataset.amount) * livePrices[element.dataset.symbol].usd,
      );
    });
    const total = me.assets.reduce(
      (sum, asset) => sum + asset.amount * livePrices[asset.symbol].usd,
      0,
    );
    const totalElement = document.getElementById("livePortfolioValue");
    if (totalElement) totalElement.textContent = money(total);
    const stamp = document.getElementById("marketUpdated");
    if (stamp)
      stamp.textContent = data.stale
        ? "Market data temporarily unavailable"
        : `Live market prices · updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    /* Keep the last known values visible if market data is unavailable. */
  }
}
function startPriceRefresh() {
  refreshLivePrices();
  if (!priceTimer) priceTimer = setInterval(refreshLivePrices, 60_000);
}
function transactionRows(all = false) {
  const txs = all ? me.transactions : me.transactions.slice(0, 5);
  return (
    txs
      .map((tx) => {
        const [icon, , cls] = meta[tx.asset] || ["•", tx.asset, ""];
        const state =
          tx.status === "pending"
            ? '<span class="status off">Pending</span>'
            : tx.status === "cancelled"
              ? '<span class="status off">Cancelled</span>'
              : "";
        return `<div class="tx"><div class="tx-left"><span class="token ${cls}">${icon}</span><div><b>${tx.title}</b><div class="small">${tx.subtitle} · ${tx.time}</div></div></div><div class="amount ${tx.amount.startsWith("+") && tx.status !== "cancelled" ? "positive" : ""}">${tx.amount}<div class="small">${tx.value}</div>${state}</div></div>`;
      })
      .join("") ||
    '<p class="small">No activity yet. Add funds to begin building your Vault.</p>'
  );
}
function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
function dashboard() {
  shell(
    `<header class="topbar"><div><h1>${timeGreeting()}, ${me.name.split(" ")[0]}.</h1><p>Here’s how your Vault is doing today.</p></div><div class="profile"><div class="avatar">${initials(me.name)}</div>${me.name}</div></header><div class="grid"><div><div class="card balance-card"><div class="balance-label">Total Vault value</div><div class="balance" id="livePortfolioValue">${money(me.assets.reduce((sum, asset) => sum + asset.amount * livePrices[asset.symbol].usd, 0))}</div><span class="gain">↗ ${me.change}% this month</span><div class="actions"><button class="action" onclick="walletModal('receive')">↓ Receive</button><button class="action secondary" onclick="walletModal('send')">↑ Send</button><button class="action secondary" onclick="walletModal('swap')">⇄ Swap</button></div></div><div class="card" style="margin-top:18px"><h3>Your assets</h3><div class="small" id="marketUpdated">Loading live market prices…</div>${assetRows()}</div></div><div class="card"><h3>Recent activity</h3>${transactionRows()}<div class="switch" style="text-align:left"><span class="link" onclick="activity()">View all activity →</span></div></div></div>`,
  );
  startPriceRefresh();
}
function activity() {
  shell(
    `<header class="topbar"><div><h1>Account activity</h1><p>Your activity will appear here.</p></div><button class="primary" onclick="walletModal('receive')">Add funds</button></header><div class="card"><h3>Transaction history</h3>${transactionRows(true)}</div>`,
    "activity",
  );
}
function walletModal(type) {
  const titles = {
    receive: "Receive assets",
    send: "Send assets",
    swap: "Swap assets",
  };
  const fields =
    type === "send"
      ? `<label class="field">RECIPIENT WALLET ADDRESS</label><input class="input" id="address" placeholder="0x...">`
      : "";
  const receiveOptions =
    type === "receive"
      ? `<option value="BTC">BTC — Bitcoin</option><option value="ETH">ETH — Ethereum (ERC20)</option><option value="USDT">USDT — Tether (TRC20)</option><option value="USDC">USDC — USD Coin (ERC20)</option>`
      : "";
  const swap =
    type === "swap"
      ? `<label class="field">FROM ASSET</label><select class="input" id="from">${options}</select><label class="field">TO ASSET</label><select class="input" id="to"><option value="USDC">USDC — USD Coin</option><option value="ETH">ETH — Ethereum</option><option value="BTC">BTC — Bitcoin</option></select>`
      : `<label class="field">ASSET</label><select class="input" id="symbol" onchange="updateReceiveAddress(this.value)">${receiveOptions || options}</select>`;
  const receivePanel =
    type === "receive"
      ? `<div class="receive-addresses" id="receiveAddressPanel"><div class="receive-intro"><span class="eyebrow">Deposit destination</span><p>Use the matching network when sending funds to your Vault.</p></div><div class="receive-address" id="receiveAddressRow"></div></div>`
      : "";
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-bg" id="modal"><div class="modal"><div class="modal-head"><h2>${titles[type]}</h2><button class="close" onclick="modal.remove()">×</button></div><div id="modalError"></div>${fields}${swap}${receivePanel}<label class="field">AMOUNT</label><input class="input" id="amount" type="number" min="0" step="any" placeholder="0.00"><button class="primary wide" onclick="submitWallet('${type}')">${type === "receive" ? "Request deposit approval" : type === "send" ? "Request send" : "Confirm swap"}</button><p class="small" style="margin-top:16px">${type === "receive" ? "Your request will appear in your activity and is credited only after blockchain confirmation." : type === "send" ? "Your balance is not deducted until blockchain confirmation." : "Ensure you verify the details before confirming."}</p></div></div>`,
  );
  if (type === "receive") updateReceiveAddress("BTC");
}
function updateReceiveAddress(symbol) {
  const panel = document.getElementById("receiveAddressPanel");
  const row = document.getElementById("receiveAddressRow");
  const address = receiveAddresses[symbol];
  if (!panel || !row || !address) return;
  panel.hidden = false;
  row.innerHTML = `<div><strong>${symbol}</strong><span>${address[0]}</span><code>${address[1]}</code></div><button class="copy-address" onclick="copyWalletAddress(this, '${address[1]}')" aria-label="Copy ${symbol} wallet address">Copy</button>`;
}
async function copyWalletAddress(button, walletAddress) {
  try {
    await navigator.clipboard.writeText(walletAddress);
    const originalText = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = originalText;
    }, 1600);
  } catch {
    alert("Unable to copy this address. Please select it manually.");
  }
}
async function submitWallet(type) {
  try {
    const body = { amount: amount.value };
    if (type === "swap") {
      body.from = from.value;
      body.to = to.value;
    } else body.symbol = symbol.value;
    if (type === "send") body.address = address.value;
    me = await api(`/api/wallet/${type}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (type === "receive") {
      const confirmButton = document.querySelector(
        '#modal button[onclick^="submitWallet"]',
      );
      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.innerHTML =
          '<span class="button-spinner"></span> Confirmed';
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    modal.remove();
    dashboard();
  } catch (error) {
    modalError.innerHTML = `<div class="error">${error.message}</div>`;
  }
}
async function admin() {
  try {
    const [allUsers, deposits, withdrawals] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/deposits"),
      api("/api/admin/withdrawals"),
    ]);
    users = allUsers;
    const customers = users.filter((user) => user.role !== "admin");
    const rows = customers
      .map(
        (user) =>
          `<tr><td><b>${user.name}</b><div class="small">${user.email}</div></td><td>${money(user.balance)}</td><td><span class="status ${user.verified ? "" : "off"}">${user.verified ? "Verified" : "Pending"}</span></td><td>${user.createdAt}</td><td><button class="edit" onclick="editUser('${user.id}')">Manage</button></td></tr>`,
      )
      .join("");
    shell(
      `<header class="topbar"><div><h1>Admin console</h1><p>Updates are applied only to the account you select.</p></div><div class="profile"><div class="avatar">${initials(me.name)}</div>${me.name}</div></header>${pendingDeposits(deposits)}${pendingWithdrawals(withdrawals)}<div class="card"><h3>All customer accounts <span class="small">(${customers.length})</span></h3><div style="overflow:auto"><table class="admin-table"><thead><tr><th>User</th><th>Portfolio</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="small">No customer accounts yet.</td></tr>'}</tbody></table></div></div>`,
      "admin",
    );
  } catch {
    dashboard();
  }
}
function pendingDeposits(deposits) {
  const pending = deposits.filter((item) => item.status === "pending");
  if (!pending.length)
    return '<div class="card" style="margin-bottom:18px"><h3>Pending deposit requests</h3><p class="small">No requests awaiting approval.</p></div>';
  return `<div class="card" style="margin-bottom:18px"><h3>Pending deposit requests <span class="small">(${pending.length})</span></h3>${pending.map((item) => `<div class="tx"><div class="tx-left"><span class="token ${meta[item.symbol][2]}">${meta[item.symbol][0]}</span><div><b>${item.user.name}</b><div class="small">${item.user.email} · ${item.symbol} ${item.amount}</div></div></div><div class="actions" style="margin:0"><button class="action" onclick="processDeposit('${item.id}','approve')">Approve</button><button class="action secondary" onclick="processDeposit('${item.id}','cancel')">Cancel</button></div></div>`).join("")}</div>`;
}
async function processDeposit(id, action) {
  try {
    await api(`/api/admin/deposits/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    admin();
  } catch (error) {
    alert(error.message);
  }
}
function pendingWithdrawals(withdrawals) {
  const pending = withdrawals.filter((item) => item.status === "pending");
  if (!pending.length)
    return '<div class="card" style="margin-bottom:18px"><h3>Pending send requests</h3><p class="small">No sends awaiting approval.</p></div>';
  return `<div class="card" style="margin-bottom:18px"><h3>Pending send requests <span class="small">(${pending.length})</span></h3>${pending.map((item) => `<div class="tx"><div class="tx-left"><span class="token ${meta[item.symbol][2]}">${meta[item.symbol][0]}</span><div><b>${item.user.name}</b><div class="small">${item.symbol} ${item.amount} → ${item.address.slice(0, 8)}…${item.address.slice(-4)}</div></div></div><div class="actions" style="margin:0"><button class="action" onclick="processWithdrawal('${item.id}','approve')">Approve</button><button class="action secondary" onclick="processWithdrawal('${item.id}','cancel')">Cancel</button></div></div>`).join("")}</div>`;
}
async function processWithdrawal(id, action) {
  try {
    await api(`/api/admin/withdrawals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    admin();
  } catch (error) {
    alert(error.message);
  }
}
function editUser(id) {
  const user = users.find((item) => item.id === id);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-bg" id="modal"><div class="modal"><div class="modal-head"><h2>Manage account</h2><button class="close" onclick="modal.remove()">×</button></div><label class="field">NAME</label><input class="input" id="editName" value="${user.name}"><label class="field">EMAIL</label><input class="input" id="editEmail" value="${user.email}"><div class="form-row"><div><label class="field">CURRENT PORTFOLIO</label><div class="input" style="color:#bfc6d6">${money(user.balance)}</div></div><div><label class="field">MONTHLY CHANGE (%)</label><input class="input" id="editChange" type="number" value="${user.change}"></div></div><label class="field">ADD FUNDS (USDC)</label><input class="input" id="adminCredit" type="number" min="0" step="0.01" placeholder="Enter an amount to add"><div class="small" style="margin-top:7px">This adds to the current balance; it never replaces it.</div><label class="field">VERIFICATION</label><select class="input" id="editVerified"><option value="true" ${user.verified ? "selected" : ""}>Verified</option><option value="false" ${!user.verified ? "selected" : ""}>Pending</option></select><button class="primary wide" onclick="saveUser('${id}')">Save changes</button><button class="danger wide" onclick="deleteUser('${id}')">Delete account</button></div></div>`,
  );
}
async function saveUser(id) {
  try {
    await api(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: editName.value,
        email: editEmail.value,
        change: editChange.value,
        verified: editVerified.value === "true",
      }),
    });
    const credit = Number(document.getElementById("adminCredit").value);
    if (credit > 0)
      await api(`/api/admin/users/${id}/funds`, {
        method: "POST",
        body: JSON.stringify({ amount: credit }),
      });
    modal.remove();
    admin();
  } catch (error) {
    alert(error.message);
  }
}
async function deleteUser(id) {
  const user = users.find((item) => item.id === id);
  if (!user || !confirm(`Delete ${user.name}'s account permanently?`)) return;
  try {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    modal.remove();
    admin();
  } catch (error) {
    alert(error.message);
  }
}
function confirmSignOut() {
  return new Promise((resolve) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="modal-bg" id="confirmModal"><div class="modal confirm-modal"><div class="modal-head"><h2>Sign out?</h2><button class="close" onclick="resolveSignOut(false)">×</button></div><p class="confirm-copy">Your session will be ended on this device.</p><div class="confirm-actions"><button class="action secondary" onclick="resolveSignOut(false)">Stay signed in</button><button class="primary" onclick="resolveSignOut(true)">Sign out</button></div></div></div>`,
    );
    window.resolveSignOut = (confirmed) => {
      document.getElementById("confirmModal")?.remove();
      delete window.resolveSignOut;
      resolve(confirmed);
    };
  });
}
async function logout() {
  if (!(await confirmSignOut())) return;
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  localStorage.removeItem("vf_token");
  token = null;
  me = null;
  landing();
}
async function boot() {
  if (!token) return landing();
  try {
    me = await api("/api/me");
    dashboard();
  } catch {
    localStorage.removeItem("vf_token");
    token = null;
    landing();
  }
}
boot();
