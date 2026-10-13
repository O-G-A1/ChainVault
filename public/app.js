const app = document.querySelector("#app");
let token = localStorage.getItem("vf_token"),
  me = null,
  users = [];
const SESSION_IDLE_MS = 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = "vf_last_activity";
let lastHeartbeatAt = 0;
function clearLocalSession() {
  localStorage.removeItem("vf_token");
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  token = null;
  me = null;
}
function checkIdleSession() {
  if (!token) return false;
  const lastActivityAt = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
  if (!lastActivityAt || Date.now() - lastActivityAt >= SESSION_IDLE_MS) {
    clearLocalSession();
    landing();
    return true;
  }
  return false;
}
function recordActivity() {
  if (!token || checkIdleSession()) return;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  if (Date.now() - lastHeartbeatAt < 60_000) return;
  lastHeartbeatAt = Date.now();
  fetch("/api/auth/heartbeat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).then((response) => {
    if (response.status === 401 && token) {
      clearLocalSession();
      landing();
    }
  }).catch(() => {});
}
for (const eventName of ["pointerdown", "keydown", "touchstart", "scroll"]) {
  window.addEventListener(eventName, recordActivity, { passive: true });
}
window.addEventListener("focus", checkIdleSession);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkIdleSession();
});
window.setInterval(checkIdleSession, 15_000);
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
function inAppDialog({ title, message, confirmLabel = "OK", cancelLabel }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-bg device-dialog-bg";
    backdrop.innerHTML = `<section class="modal confirm-modal device-dialog" role="alertdialog" aria-modal="true" aria-labelledby="deviceDialogTitle" aria-describedby="deviceDialogMessage"><div class="modal-head"><h2 id="deviceDialogTitle"></h2>${cancelLabel ? '<button class="close" type="button" aria-label="Close">×</button>' : ""}</div><p class="confirm-copy" id="deviceDialogMessage"></p><div class="confirm-actions">${cancelLabel ? '<button class="action secondary device-dialog-cancel" type="button"></button>' : ""}<button class="${cancelLabel ? "danger" : "primary"} device-dialog-confirm" type="button"></button></div></section>`;
    backdrop.querySelector("h2").textContent = title;
    backdrop.querySelector("#deviceDialogMessage").textContent = message;
    backdrop.querySelector(".device-dialog-confirm").textContent = confirmLabel;
    if (cancelLabel)
      backdrop.querySelector(".device-dialog-cancel").textContent = cancelLabel;
    document.body.append(backdrop);

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      resolve(result);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(false);
    };
    backdrop.querySelector(".device-dialog-confirm").addEventListener("click", () => finish(true));
    backdrop.querySelector(".device-dialog-cancel")?.addEventListener("click", () => finish(false));
    backdrop.querySelector(".close")?.addEventListener("click", () => finish(false));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(false);
    });
    document.addEventListener("keydown", onKeyDown);
    backdrop.querySelector(cancelLabel ? ".device-dialog-cancel" : ".device-dialog-confirm").focus();
  });
}
function showNotice(message, title = "Please try again") {
  return inAppDialog({ title, message });
}
function confirmInApp(message, title = "Please confirm") {
  return inAppDialog({
    title,
    message,
    confirmLabel: "Delete account",
    cancelLabel: "Keep account",
  });
}
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
let sendMethod = "wallet";
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
  app.innerHTML = `<section class="landing"><nav>${brand}<div class="nav-actions"><button class="outline" onclick="auth('login')">Sign in</button><button class="primary" onclick="auth('signup')">Get started</button></div></nav><div class="hero"><div><div class="eyebrow">Your assets, your flow</div><h1>Recover the next<br><em>with confidence.</em></h1><p>A considered home for your digital assets. Track live markets, manage your Vault, and move only when you are ready.</p><div class="hero-actions"><button class="primary" onclick="auth('signup')">Create free account →</button><button class="text-button" onclick="auth('login')">View your Vault</button></div><div class="hero-proof"><span>◉ Private account data</span><span>◉ Admin-reviewed funding</span></div></div><div class="wallet-preview"><div class="wallet-top"><span>Vault overview</span><span>•••</span></div><div class="wallet-value">$24,864.21</div><span class="gain">↗ 12.4% this month</span><div class="coins"><div class="coin">₿<b>Bitcoin</b><small>Live market</small></div><div class="coin">◆<b>Ethereum</b><small>Live market</small></div><div class="coin">$<b>USDC</b><small>Stable value</small></div></div></div></div><div class="landing-body"><section class="market-section"><div class="section-heading"><div><div class="eyebrow">Live market snapshot</div><h2>Markets at a glance.</h2></div><span class="market-status" id="landingMarketStatus">Updating prices…</span></div><div class="market-grid"><article class="market-card"><span class="token">₿</span><div><b>Bitcoin</b><small>BTC</small></div><strong data-market="BTC">—</strong></article><article class="market-card"><span class="token eth">◆</span><div><b>Ethereum</b><small>ETH</small></div><strong data-market="ETH">—</strong></article><article class="market-card"><span class="token usdc">$</span><div><b>USD Coin</b><small>USDC</small></div><strong data-market="USDC">—</strong></article></div></section><section class="feature-grid"><article><span>⌁</span><h3>One clear Vault</h3><p>See your live asset values and your exact holdings without losing the signal in the noise.</p></article><article><span>✓</span><h3>Controlled deposits</h3><p>Funding requests remain pending until they are reviewed and confirmed on the blockchain.</p></article><article><span>◈</span><h3>Account-level privacy</h3><p>Every dashboard and activity history belongs only to the account that created it.</p></article></section><section class="security-callout"><div><div class="eyebrow">Built with intention</div><h2>Your Vault, in focus.</h2><p>OnchainVault keeps the practical details close: current market value, exact balances, and a transparent activity trail.</p></div><button class="primary" onclick="auth('signup')">Start your vault</button></section></div></section>`;
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
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">${brand}<h1>${mode === "login" ? "Welcome back" : "Create your Vault"}</h1><p>${mode === "login" ? "Sign in to access your Vault." : "Start managing your digital assets today."}</p><div id="err"></div>${mode === "signup" ? '<label class="field">FULL NAME</label><input class="input" id="name" placeholder="Your name">' : ""}<label class="field">EMAIL ADDRESS</label><input class="input" id="email" type="email" placeholder="you@example.com"><label class="field">PASSWORD</label><input class="input" id="password" type="password" placeholder="At least 8 characters">${mode === "signup" ? '<label class="field">CONFIRM PASSWORD</label><input class="input" id="confirmPassword" type="password" placeholder="Type your password again" autocomplete="new-password">' : ""}<button class="primary wide" onclick="submitAuth('${mode}')">${mode === "login" ? "Sign in" : "Create account"}</button><div class="switch">${mode === "login" ? 'New to OnchainVault? <span class="link" onclick="auth(\'signup\')">Create an account</span>' : 'Already have an account? <span class="link" onclick="auth(\'login\')">Sign in</span>'}</div>${mode === "login" ? '<div class="demo">Private access · Admin-reviewed accounts</div>' : ""}</div></section>`;
}
async function submitAuth(mode) {
  try {
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const nameInput = document.getElementById("name");
    if (mode === "signup") {
      const confirmPasswordInput = document.getElementById("confirmPassword");
      if (passwordInput.value !== confirmPasswordInput.value) {
        document.getElementById("err").innerHTML =
          '<div class="error">Passwords do not match. Please re-enter them.</div>';
        return;
      }
    }
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
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    lastHeartbeatAt = Date.now();
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
  app.innerHTML = `<div class="app-shell"><aside class="side">${brand}<div class="menu"><button class="${tab === "dashboard" ? "active" : ""}" onclick="dashboard()">◈ &nbsp; Overview</button><button class="${tab === "earn" ? "active" : ""}" onclick="earn()">✦ &nbsp; Earn</button><button class="${tab === "activity" ? "active" : ""}" onclick="activity()">⇄ &nbsp; Activity</button><button onclick="walletModal('receive')">＋ &nbsp; Add funds</button>${me.role === "admin" ? `<button class="${tab === "admin" ? "active" : ""}" onclick="admin()">♙ &nbsp; Admin Console</button>` : ""}</div><div class="side-footer"><button class="menu-btn" onclick="logout()">↪ &nbsp; Sign out</button></div></aside><section class="content">${body}</section></div>`;
}
function portfolioValue(assets = [], prices = livePrices, stakes = []) {
  return (assets || []).reduce(
    (sum, asset) =>
      sum + Number(asset.amount || 0) * (prices[asset.symbol]?.usd ?? 0),
    (stakes || []).reduce(
      (sum, stake) => sum + Number(stake.amount || 0) * (prices[stake.symbol]?.usd ?? 0),
      0,
    ),
  );
}
function formatQuantity(value) {
  const quantity = Number(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(quantity)
    ? quantity.toLocaleString("en-US", { maximumFractionDigits: 3 })
    : String(value ?? "");
}
function formatAssetAmount(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity)
    ? quantity.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : String(value ?? "");
}
function formatTransactionAmount(value) {
  const amount = String(value ?? "0").trim();
  const quantity = Number(amount.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(quantity)) return amount;
  const formatted = formatQuantity(quantity);
  return amount.startsWith("+") && quantity > 0 ? `+${formatted}` : formatted;
}
function assetRows() {
  return me.assets
    .map((asset) => {
      const [icon, name, cls] = meta[asset.symbol] || ["•", asset.symbol, ""];
      const market = livePrices[asset.symbol];
      return `<div class="asset"><div class="asset-left"><span class="token ${cls}">${icon}</span><div><b>${name}</b><div class="small live-price" data-symbol="${asset.symbol}">Current value: ${money(market.usd)} · ${market.change.toFixed(2)}% (24h)</div><div class="asset-balance"><span>Your holdings</span><strong>${formatQuantity(asset.amount)} <small>${asset.symbol}</small></strong></div></div></div><b class="holding-value" data-symbol="${asset.symbol}" data-amount="${asset.amount}">${money(asset.amount * market.usd)}</b></div>`;
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
    document.querySelectorAll(".tx[data-pending='true']").forEach((row) => {
      const symbol = row.dataset.asset;
      const valueNode = row.querySelector("[data-live-value]");
      const amount = Number(
        String(row.dataset.amount || "0").replace(/[^0-9.-]/g, ""),
      );
      if (valueNode && symbol && livePrices[symbol]) {
        valueNode.textContent = money(
          Math.abs(amount) * livePrices[symbol].usd,
        );
      }
    });
    const total = portfolioValue(me.assets, livePrices, me.stakes);
    const totalElement = document.getElementById("livePortfolioValue");
    if (totalElement) totalElement.textContent = money(total);
    const earnBalance = document.getElementById("earnBalance");
    if (earnBalance) earnBalance.textContent = money(total);
    const earnGate = document.querySelector("[data-earn-gate]");
    if (earnGate && (earnGate.dataset.earnGate === "true") !== (total >= 2000))
      earn();
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
        const amountValue = Number(
          String(tx.amount || "0").replace(/[^0-9.-]/g, ""),
        );
        const displayValue =
          tx.status === "pending" && tx.asset && livePrices[tx.asset]
            ? money(Math.abs(amountValue) * livePrices[tx.asset].usd)
            : tx.value;
        const displayAmount = formatTransactionAmount(tx.amount);

        const state =
          tx.status === "pending"
            ? '<span class="status off">Pending</span>'
            : tx.status === "cancelled"
              ? '<span class="status off">Cancelled</span>'
              : "";

        const when = tx.createdAt
          ? `<span data-timeago="${tx.createdAt}">${timeAgo(tx.createdAt)}</span>`
          : tx.time;

        return `<div class="tx" data-asset="${tx.asset}" data-amount="${tx.amount}" data-pending="${tx.status === "pending"}"><div class="tx-left"><span class="token ${cls}">${icon}</span><div><b>${escapeHtml(tx.title)}</b><div class="small">${escapeHtml(tx.subtitle)} · ${when}</div></div></div><div class="amount ${tx.amount.startsWith("+") && tx.status !== "cancelled" ? "positive" : ""}">${displayAmount}<div class="small" data-live-value>${displayValue}</div>${state}</div></div>`;
      })
      .join("") ||
    '<p class="small">No activity yet. Add funds to begin building your Vault.</p>'
  );
}
function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then)) return "";
  const now = new Date();
  const diff = Math.floor((now - then) / 1000);
  const fmt = (d) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 60) return "Just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())) /
      86400000,
  );
  if (days === 0) return `Today, ${fmt(then)}`;
  if (days === 1) return `Yesterday, ${fmt(then)}`;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${then.toLocaleDateString([], { month: "short", day: "numeric" })}, ${fmt(then)}`;
}
function refreshTimeLabels() {
  document.querySelectorAll("[data-timeago]").forEach((el) => {
    const iso = el.dataset.timeago;
    el.textContent = iso ? timeAgo(iso) : "";
  });
}
function startTimeRefresh() {
  refreshTimeLabels();
  if (!timeTimer) timeTimer = setInterval(refreshTimeLabels, 30_000);
}
let timeTimer = null;
function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
function dashboard() {
  shell(
    `<header class="topbar"><div><h1>${timeGreeting()}, ${me.name.split(" ")[0]}.</h1><p>Here’s how your Vault is doing today.</p></div><div class="profile"><div class="avatar">${initials(me.name)}</div>${me.name}</div></header><div class="grid"><div><div class="card balance-card"><div class="balance-label">Total Vault value</div><div class="balance" id="livePortfolioValue">${money(portfolioValue(me.assets, livePrices, me.stakes))}</div><span class="gain">↗ ${me.change}% this month</span><div class="actions"><button class="action" onclick="walletModal('receive')">↓ Receive</button><button class="action secondary" onclick="walletModal('send')">↑ Send</button><button class="action secondary" onclick="walletModal('swap')">⇄ Swap</button></div></div><div class="card" style="margin-top:18px"><h3>Your assets</h3><div class="small" id="marketUpdated">Loading live market prices…</div>${assetRows()}</div></div><div class="card"><h3>Recent activity</h3>${transactionRows()}<div class="switch" style="text-align:left"><span class="link" onclick="activity()">View all activity →</span></div></div></div>`,
  );
  startPriceRefresh();
  startTimeRefresh();
}
function earn() {
  clearInterval(puzzleTimer);
  const balance = portfolioValue(me.assets, livePrices, me.stakes);
  const eligible = balance >= 2000;
  const game = me.earnGame || { level: 1, maxLevel: 18, pendingProfitUsd: 0, rewardCycleBalanceUsd: 0, payoutThresholdUsd: 0, challenge: null };
  const challenge = game.challenge;
  const activeRound = challenge && !challenge.completed;
  const pairs = challenge?.pairs || Math.min(6 + Math.max(0, (game.level || 1) - 1), 18);
  puzzleState = {
    challengeId: activeRound ? challenge.id : null,
    deck: challenge ? [...challenge.visibleCards] : Array(pairs * 2).fill(null),
    open: activeRound ? [...challenge.openIndices] : [],
    matched: activeRound ? [...challenge.matchedIndices] : challenge?.completed ? [...(challenge.matchedIndices || [])] : [],
    moves: activeRound ? challenge.moves : challenge?.moves || 0,
    busy: false,
    started: Boolean(activeRound),
    startedAt: activeRound ? challenge.startedAt : null,
  };
  const pendingProfit = Number(game.pendingProfitUsd || 0);
  const threshold = Number(game.payoutThresholdUsd || 0);
  const progress = threshold > 0 ? Math.min(100, pendingProfit / threshold * 100) : 0;
  const payoutCopy = balance <= 0
    ? "A starting balance is required for game rewards. Rounds still advance your difficulty."
    : threshold > 0
      ? `${money(pendingProfit)} accumulated · ${money(Math.max(0, threshold - pendingProfit))} until transfer to your balance`
      : "Complete a round to start building your game reward balance.";
  const lastReward = game.lastReward;
  const lastRoundCopy = activeRound
    ? "Round in progress · find every matching pair."
    : challenge?.completed && lastReward
      ? lastReward.rewardUsd > 0
        ? `Round ${lastReward.level} · ${lastReward.elapsedSeconds}s · ${lastReward.rewardRatePercent.toFixed(3)}% rate · ${lastReward.payoutUsd > 0 ? `${money(lastReward.payoutUsd)} transferred to your balance.` : `${money(lastReward.rewardUsd)} added to game profits.`}`
        : `Round ${lastReward.level} complete · no reward without a starting balance.`
      : `Level ${game.level || 1} · complete the round to earn from ${challenge?.pairs || pairs} pairs.`;
  const positions = (me.stakes || []).map((stake) => {
    const [icon, name, cls] = meta[stake.symbol] || ["•", stake.symbol, ""];
    const nextReward = stakeNextRewardDate(stake);
    const monthlyReward = Number(stake.amount) * 0.1;
    return `<article class="card position-card"><div class="position-main"><span class="token ${cls}">${icon}</span><div><b>${name} staking</b><div class="small">${formatAssetAmount(stake.amount)} ${stake.symbol} staked</div></div></div><div class="position-stat"><span>Monthly reward</span><strong>+${formatAssetAmount(monthlyReward)} ${stake.symbol}</strong></div><div class="position-stat"><span>Next reward</span><strong>${nextReward.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</strong></div><button class="outline unstake-button" onclick="unstake('${stake.id}')">Unstake</button></article>`;
  }).join("");
  shell(
    `<header class="topbar"><div><h1>Earn</h1><p>Put your assets to work and build your Vault.</p></div><div class="profile"><div class="avatar">✦</div>Earn</div></header><section class="card earn-summary" data-earn-gate="${eligible}"><div><div class="balance-label">Total Vault value</div><div class="balance" id="earnBalance">${money(balance)}</div><div class="earn-status ${eligible ? "eligible" : "locked"}">${eligible ? "Available to stake" : "Locked · $2,000 minimum balance"}</div></div></section><section class="earn-welcome"><div><div class="eyebrow">Earn opportunities</div><h2>Make more of your assets.</h2><p>Stake a supported asset to earn a monthly reward, or take a quick puzzle break.</p></div><span class="earn-spark">✦</span></section><div class="game-profit-card card"><div class="game-profit-head"><div><span class="eyebrow">Puzzle rewards</span><h3>Game profit balance</h3></div><span class="game-level-badge">Level ${game.level || 1} <small>/ ${game.maxLevel || 18}</small></span></div><div class="game-profit-values"><strong>${money(pendingProfit)}</strong><span>${threshold > 0 ? `of ${money(threshold)} · 5% of starting balance` : "5% of starting balance"}</span></div><div class="progress-track" role="progressbar" aria-label="Progress to game reward transfer" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.toFixed(0)}"><span style="width:${progress.toFixed(2)}%"></span></div><p class="game-profit-copy">${payoutCopy}</p></div><div class="earn-grid"><article class="card earn-task stake-offer"><div class="offer-heading"><div class="task-icon">◈</div><span class="rate-badge">10% monthly</span></div><div class="task-tag">FLEXIBLE STAKING</div><h3>Stake crypto</h3><p>Choose any supported asset and stake up to your available balance. Earn 10% of your staked amount each month, paid in the same crypto.</p><div class="task-footer"><span class="small">Unstake any time</span><button class="primary" onclick="startStaking()" ${eligible ? "" : "disabled"}>${eligible ? "Start staking" : "Unlock at $2,000"}</button></div></article><article class="card earn-task puzzle-card"><div class="offer-heading"><div class="task-icon task-icon-green">⌘</div><span class="puzzle-label">LEVEL ${challenge?.level || game.level || 1} · ${pairs} PAIRS</span></div><div class="task-tag">ONCHAIN PUZZLE</div><h3>Crypto match</h3><p>Match every pair. Each round starts at 0.05% of your balance; faster clears and higher levels increase the rate. Game profits transfer when they reach 5% of your starting balance.</p><div class="puzzle-scoreline"><span id="puzzleProgress">${challenge?.completed ? pairs : challenge?.matchedIndices?.length / 2 || 0} of ${pairs} pairs · ${challenge?.moves || 0} moves</span><span id="puzzleClock">${activeRound ? puzzleTime() : "Ready when you are"}</span></div><div class="puzzle-board" id="puzzleBoard" aria-label="Crypto matching puzzle"></div><div class="puzzle-foot"><span class="small" id="puzzleResult">${lastRoundCopy}</span><button class="outline" id="puzzleStartButton" onclick="startPuzzle()">${activeRound ? "Resume round" : challenge?.completed ? "Start next level" : "Start puzzle"}</button></div></article></div>${positions ? `<section class="active-stakes"><div class="section-heading"><div><div class="eyebrow">Your positions</div><h2>Active staking</h2></div><span class="small">${(me.stakes || []).length} position${(me.stakes || []).length === 1 ? "" : "s"}</span></div><div class="position-list">${positions}</div></section>` : ""}`,
    "earn",
  );
  renderPuzzle();
  if (activeRound) startPuzzleClock();
  startPriceRefresh();
}
function stakeNextRewardDate(stake) {
  const date = new Date(stake.startedAt);
  const targetMonth = date.getUTCMonth() + Number(stake.maturedMonths || 0) + 1;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(targetMonth);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}
function startStaking() {
  if (portfolioValue(me.assets, livePrices, me.stakes) < 2000) return;
  const available = (me.assets || []).filter((asset) => Number(asset.amount) > 0);
  if (!available.length) {
    showNotice("There are no available assets to stake. Unstake a position or add funds to continue.", "No available assets");
    return;
  }
  const choices = available.map((asset) => {
    const [icon, name] = meta[asset.symbol] || ["•", asset.symbol];
    return `<option value="${asset.symbol}">${icon} ${asset.symbol} · ${name}</option>`;
  }).join("");
  document.body.insertAdjacentHTML("beforeend", `<div class="modal-bg" id="stakeModal"><section class="modal stake-modal" role="dialog" aria-modal="true" aria-labelledby="stakeTitle"><div class="modal-head"><h2 id="stakeTitle">Start staking</h2><button class="close" onclick="document.getElementById('stakeModal').remove()" aria-label="Close">×</button></div><p class="stake-intro">Earn <strong>10% monthly</strong> on your staked amount. Rewards are credited in the same crypto.</p><label class="field" for="stakeSymbol">CRYPTO ASSET</label><select class="input" id="stakeSymbol" onchange="updateStakeEstimate()">${choices}</select><div class="available-line" id="stakeAvailable"></div><label class="field" for="stakeAmount">AMOUNT TO STAKE</label><input class="input" id="stakeAmount" type="number" min="0.0000001" step="0.0000001" placeholder="Enter amount" oninput="updateStakeEstimate()"><div class="stake-estimate" id="stakeEstimate">Estimated monthly reward: —</div><div id="stakeError"></div><button class="primary wide" id="stakeSubmit" onclick="submitStake()">Confirm stake</button></section></div>`);
  updateStakeEstimate();
  document.getElementById("stakeAmount").focus();
}
function updateStakeEstimate() {
  const symbol = document.getElementById("stakeSymbol")?.value;
  const amountInput = document.getElementById("stakeAmount");
  const asset = (me.assets || []).find((item) => item.symbol === symbol);
  if (!symbol || !asset || !amountInput) return;
  const amount = Number(amountInput.value);
  document.getElementById("stakeAvailable").textContent = `Available: ${formatAssetAmount(asset.amount)} ${symbol} · ${money(asset.amount * (livePrices[symbol]?.usd || 0))}`;
  document.getElementById("stakeEstimate").textContent = `Estimated monthly reward: ${amount > 0 ? `${formatAssetAmount(amount * 0.1)} ${symbol} (${money(amount * 0.1 * (livePrices[symbol]?.usd || 0))})` : "—"}`;
  amountInput.max = String(asset.amount);
}
async function submitStake() {
  const button = document.getElementById("stakeSubmit");
  const error = document.getElementById("stakeError");
  const symbol = document.getElementById("stakeSymbol").value;
  const amount = Number(document.getElementById("stakeAmount").value);
  button.disabled = true;
  button.innerHTML = '<span class="button-spinner"></span>Starting stake…';
  error.innerHTML = "";
  try {
    me = await api("/api/earn/stakes", { method: "POST", body: JSON.stringify({ symbol, amount }) });
    document.getElementById("stakeModal").remove();
    earn();
  } catch (issue) {
    error.innerHTML = `<div class="error">${issue.message}</div>`;
    button.disabled = false;
    button.textContent = "Confirm stake";
  }
}
async function unstake(stakeId) {
  const accepted = await inAppDialog({ title: "Unstake crypto?", message: "Your principal will return to your available balance. Any monthly rewards already credited will remain in your Vault.", confirmLabel: "Unstake position", cancelLabel: "Keep staking" });
  if (!accepted) return;
  try {
    me = await api(`/api/earn/stakes/${encodeURIComponent(stakeId)}`, { method: "DELETE" });
    earn();
  } catch (issue) {
    showNotice(issue.message);
  }
}
let puzzleTimer = null;
let puzzleState = { deck: [], open: [], matched: [], moves: 0, seconds: 0, busy: false, started: false };
async function startPuzzle() {
  const button = document.getElementById("puzzleStartButton");
  if (button) { button.disabled = true; button.textContent = "Loading round…"; }
  try {
    const response = await api("/api/earn/game/start", { method: "POST", body: JSON.stringify({}) });
    me.earnGame = response.game;
    earn();
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "Start puzzle"; }
    showNotice(error.message);
  }
}
function puzzleTime() {
  const seconds = puzzleState.startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(puzzleState.startedAt).getTime()) / 1000))
    : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function startPuzzleClock() {
  clearInterval(puzzleTimer);
  puzzleTimer = setInterval(() => {
    const clock = document.getElementById("puzzleClock");
    if (clock && puzzleState.started) clock.textContent = puzzleTime();
  }, 1000);
}
function renderPuzzle() {
  const board = document.getElementById("puzzleBoard");
  if (!board) return;
  board.innerHTML = puzzleState.deck.map((icon, index) => {
    const shown = puzzleState.deck[index] !== null || puzzleState.open.includes(index) || puzzleState.matched.includes(index);
    return `<button class="puzzle-tile ${shown ? "revealed" : ""} ${puzzleState.matched.includes(index) ? "matched" : ""}" onclick="flipPuzzleTile(${index})" aria-label="${shown ? icon : "Hidden tile"}" ${shown || !puzzleState.started || puzzleState.busy ? "disabled" : ""}>${shown ? icon : "?"}</button>`;
  }).join("");
  const progress = document.getElementById("puzzleProgress");
  if (progress) progress.textContent = `${puzzleState.matched.length / 2} pairs · ${puzzleState.moves} moves`;
  const clock = document.getElementById("puzzleClock");
  if (clock) clock.textContent = puzzleState.started ? puzzleTime() : "Ready when you are";
}
async function flipPuzzleTile(index) {
  if (!puzzleState.started || puzzleState.busy || puzzleState.open.includes(index) || puzzleState.matched.includes(index)) return;
  puzzleState.busy = true;
  renderPuzzle();
  try {
    const response = await api("/api/earn/game/flip", {
      method: "POST",
      body: JSON.stringify({ challengeId: puzzleState.challengeId, index }),
    });
    me.earnGame = response.game;
    if (response.selected) {
      puzzleState.deck[index] = response.selected.symbol;
      puzzleState.open = [index];
      puzzleState.busy = false;
      renderPuzzle();
      return;
    }
    response.revealed.forEach((tile) => { puzzleState.deck[tile.index] = tile.symbol; });
    puzzleState.moves = response.game.challenge.moves;
    if (response.match) {
      puzzleState.matched = [...response.game.challenge.matchedIndices];
      puzzleState.open = [];
      puzzleState.busy = false;
      if (response.result) {
        me = response.user;
        earn();
        return;
      }
      renderPuzzle();
      return;
    }
    puzzleState.open = response.revealed.map((tile) => tile.index);
    puzzleState.busy = true;
    renderPuzzle();
    setTimeout(() => {
      puzzleState.open = [];
      puzzleState.deck = [...(me.earnGame.challenge?.visibleCards || puzzleState.deck.map((symbol, tileIndex) => puzzleState.matched.includes(tileIndex) ? symbol : null))];
      puzzleState.busy = false;
      renderPuzzle();
    }, 800);
  } catch (error) {
    puzzleState.busy = false;
    renderPuzzle();
    showNotice(error.message);
  }
}
function activity() {
  shell(
    `<header class="topbar"><div><h1>Account activity</h1><p>Your activity will appear here.</p></div><button class="primary" onclick="walletModal('receive')">Add funds</button></header><div class="card"><h3>Transaction history</h3>${transactionRows(true)}</div>`,
    "activity",
  );
  startTimeRefresh();
}
function walletModal(type) {
  const titles = {
    receive: "Receive assets",
    send: "Send assets",
    swap: "Swap assets",
  };
  const fields =
    type === "send"
      ? `<div class="send-methods" role="group" aria-label="Send destination"><button class="send-method active" id="walletMethodButton" onclick="setSendMethod('wallet')">Crypto address</button><button class="send-method" id="bankMethodButton" onclick="setSendMethod('bank')">Bank account</button></div><div class="send-fields" id="walletSendFields"><label class="field" for="address">RECIPIENT WALLET ADDRESS</label><input class="input" id="address" placeholder="0x..." autocomplete="off"></div><div class="send-fields" id="bankSendFields" hidden><div class="bank-transfer-note">Bank transfers are available for USDC only and require review before processing.</div><label class="field" for="bankCountry">COUNTRY</label><input class="input bank-input" id="bankCountry" autocomplete="country-name" placeholder="Country"><label class="field" for="accountName">ACCOUNT HOLDER NAME</label><input class="input bank-input" id="accountName" autocomplete="name" placeholder="Name on the account"><label class="field" for="bankName">BANK NAME</label><input class="input bank-input" id="bankName" autocomplete="organization" placeholder="Bank name"><label class="field" for="accountNumber">ACCOUNT NUMBER / IBAN</label><input class="input bank-input" id="accountNumber" autocomplete="off" placeholder="Account number or IBAN"><label class="field" for="bankCode">SWIFT / BIC OR ROUTING CODE</label><input class="input bank-input" id="bankCode" autocomplete="off" placeholder="Bank identifier code"></div>`
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
    `<div class="modal-bg" id="modal"><div class="modal"><div class="modal-head"><h2>${titles[type]}</h2><button class="close" onclick="modal.remove()">×</button></div><div id="modalError"></div>${fields}${swap}${receivePanel}<label class="field" for="amount">AMOUNT</label><input class="input" id="amount" type="number" min="0" step="any" placeholder="0.00"><button class="primary wide" id="walletSubmitButton" onclick="submitWallet('${type}')">${type === "receive" ? "Request deposit approval" : type === "send" ? "Request send" : "Confirm swap"}</button><p class="small" id="walletModalNote" style="margin-top:16px">${type === "receive" ? "Your request will appear in your activity and is credited only after blockchain confirmation." : type === "send" ? "Your balance is not deducted until blockchain confirmation." : "Ensure you verify the details before confirming."}</p></div></div>`,
  );
  if (type === "receive") updateReceiveAddress("BTC");
  if (type === "send") {
    sendMethod = "wallet";
    document.querySelectorAll("#modal .send-fields input, #modal #amount").forEach((input) => input.addEventListener("input", updateSendButtonState));
    setSendMethod("wallet");
  }
}
function updateSendButtonState() {
  const button = document.getElementById("walletSubmitButton");
  if (!button) return;
  const amount = Number(document.getElementById("amount")?.value);
  const requiredFields = sendMethod === "bank"
    ? ["bankCountry", "accountName", "bankName", "accountNumber", "bankCode"]
    : ["address"];
  const complete = amount > 0 && requiredFields.every((id) => document.getElementById(id)?.value.trim());
  button.disabled = !complete;
  button.style.opacity = complete ? "1" : "0.55";
  button.style.cursor = complete ? "pointer" : "not-allowed";
}
function setSendMethod(method) {
  sendMethod = method === "bank" ? "bank" : "wallet";
  const bank = sendMethod === "bank";
  document.getElementById("walletSendFields").hidden = bank;
  document.getElementById("bankSendFields").hidden = !bank;
  document.getElementById("walletMethodButton").classList.toggle("active", !bank);
  document.getElementById("bankMethodButton").classList.toggle("active", bank);
  const assetSelect = document.getElementById("symbol");
  if (assetSelect) {
    if (bank) assetSelect.value = "USDC";
    assetSelect.disabled = bank;
  }
  document.getElementById("walletSubmitButton").textContent = bank ? "Request bank transfer" : "Request send";
  document.getElementById("walletModalNote").textContent = bank
    ? "Your USDC remains in your Vault until your bank transfer is reviewed and marked sent."
    : "Your balance is not deducted until blockchain confirmation.";
  updateSendButtonState();
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
    showNotice("Unable to copy this address. Please select it manually.", "Copy unavailable");
  }
}
async function submitWallet(type) {
  const confirmButton = document.querySelector(
    '#modal button[onclick^="submitWallet"]',
  );
  try {
    if (type === "send") {
      if (sendMethod === "bank") {
        const bankAccount = {
          country: bankCountry.value.trim(),
          accountName: accountName.value.trim(),
          bankName: bankName.value.trim(),
          accountNumber: accountNumber.value.trim(),
          bankCode: bankCode.value.trim(),
        };
        if (Object.values(bankAccount).some((value) => !value)) {
          modalError.innerHTML = '<div class="error">Complete all bank account details to continue.</div>';
          return;
        }
      } else if (!address.value.trim()) {
        modalError.innerHTML = '<div class="error">Please include a recipient address before requesting a send.</div>';
        return;
      }
    }
    const body = { amount: amount.value };
    if (type === "swap") {
      body.from = from.value;
      body.to = to.value;
      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.innerHTML = '<span class="button-spinner"></span> Swapping…';
      }
    } else body.symbol = type === "send" && sendMethod === "bank" ? "USDC" : symbol.value;
    if (type === "send" && sendMethod === "bank") {
      body.destinationType = "bank";
      body.bankAccount = {
        country: bankCountry.value.trim(),
        accountName: accountName.value.trim(),
        bankName: bankName.value.trim(),
        accountNumber: accountNumber.value.trim(),
        bankCode: bankCode.value.trim(),
      };
    } else if (type === "send") {
      body.destinationType = "wallet";
      body.address = address.value.trim();
    }
    me = await api(`/api/wallet/${type}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (type === "swap" && confirmButton) {
      confirmButton.innerHTML = "✓ Swapped";
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    if (type === "receive") {
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
    if (type === "swap" && confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent = "Confirm swap";
    }
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
          `<tr><td><b>${user.name}</b><div class="small">${user.email}</div></td><td>${money(portfolioValue(user.assets, livePrices, user.stakes))}</td><td><span class="status ${user.verified ? "" : "off"}">${user.verified ? "Verified" : "Pending"}</span></td><td>${user.createdAt}</td><td><button class="edit" onclick="editUser('${user.id}')">Manage</button></td></tr>`,
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
    showNotice(error.message);
  }
}
function pendingWithdrawals(withdrawals) {
  const pending = withdrawals.filter((item) => item.status === "pending");
  if (!pending.length)
    return '<div class="card" style="margin-bottom:18px"><h3>Pending send requests</h3><p class="small">No sends awaiting approval.</p></div>';
  return `<div class="card" style="margin-bottom:18px"><h3>Pending send requests <span class="small">(${pending.length})</span></h3>${pending.map((item) => {
    const bankTransfer = item.destinationType === "bank" && item.bankAccount;
    const destination = bankTransfer
      ? `<div class="bank-request-details"><b>Bank account · ${escapeHtml(item.bankAccount.country)}</b><span>${escapeHtml(item.bankAccount.accountName)} · ${escapeHtml(item.bankAccount.bankName)}</span><span>Account: ${escapeHtml(item.bankAccount.accountNumber)}</span><span>Bank code: ${escapeHtml(item.bankAccount.bankCode)}</span></div>`
      : `<div class="small">${item.symbol} ${item.amount} → ${escapeHtml(item.address || "")}</div>`;
    return `<div class="tx"><div class="tx-left"><span class="token ${meta[item.symbol]?.[2] || ""}">${meta[item.symbol]?.[0] || "•"}</span><div><b>${escapeHtml(item.user?.name)} · ${item.symbol} ${item.amount}</b>${destination}</div></div><div class="actions" style="margin:0"><button class="action" onclick="processWithdrawal('${item.id}','approve')">${bankTransfer ? "Mark sent" : "Approve"}</button><button class="action secondary" onclick="processWithdrawal('${item.id}','cancel')">Cancel</button></div></div>`;
  }).join("")}</div>`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
async function processWithdrawal(id, action) {
  try {
    await api(`/api/admin/withdrawals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    });
    admin();
  } catch (error) {
    showNotice(error.message);
  }
}
function editUser(id) {
  const user = users.find((item) => item.id === id);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-bg" id="modal"><div class="modal"><div class="modal-head"><h2>Manage account</h2><button class="close" onclick="modal.remove()">×</button></div><label class="field">NAME</label><input class="input" id="editName" value="${user.name}"><label class="field">EMAIL</label><input class="input" id="editEmail" value="${user.email}"><div class="form-row"><div><label class="field">CURRENT PORTFOLIO</label><div class="input" style="color:#bfc6d6">${money(portfolioValue(user.assets, livePrices, user.stakes))}</div></div><div><label class="field">MONTHLY CHANGE (%)</label><input class="input" id="editChange" type="number" value="${user.change}"></div></div><label class="field">ADD FUNDS (USDC)</label><input class="input" id="adminCredit" type="number" min="0" step="0.01" placeholder="Enter an amount to add"><label class="field">WITHDRAW FUNDS (USDC)</label><input class="input" id="adminWithdrawal" type="number" min="0" step="0.01" placeholder="Enter an amount to remove"><label class="field">MINIMUM BALANCE TO WITHDRAW (USD)</label><input class="input" id="editWithdrawalLimit" type="number" min="0" step="0.01" value="${user.withdrawalLimit ?? ""}" placeholder="Leave blank to remove limit"><div class="small" style="margin-top:7px">Users cannot withdraw unless their total portfolio reaches this minimum balance. Leave blank or zero to remove it.</div><label class="field">VERIFICATION</label><select class="input" id="editVerified"><option value="true" ${user.verified ? "selected" : ""}>Verified</option><option value="false" ${!user.verified ? "selected" : ""}>Pending</option></select><button class="primary wide" onclick="saveUser('${id}')">Save changes</button><button class="danger wide" onclick="deleteUser('${id}')">Delete account</button></div></div>`,
  );
}
async function saveUser(id) {
  try {
    const parsedLimit = document.getElementById("editWithdrawalLimit").value;
    await api(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: editName.value,
        email: editEmail.value,
        change: editChange.value,
        verified: editVerified.value === "true",
        withdrawalLimit: parsedLimit === "" ? null : Number(parsedLimit),
      }),
    });
    const credit = Number(document.getElementById("adminCredit").value);
    const withdrawal = Number(document.getElementById("adminWithdrawal").value);
    if (credit > 0)
      await api(`/api/admin/users/${id}/funds`, {
        method: "POST",
        body: JSON.stringify({ amount: credit }),
      });
    if (withdrawal > 0)
      await api(`/api/admin/users/${id}/adjustment`, {
        method: "POST",
        body: JSON.stringify({ amount: -withdrawal }),
      });
    modal.remove();
    admin();
  } catch (error) {
    showNotice(error.message);
  }
}
async function deleteUser(id) {
  const user = users.find((item) => item.id === id);
  if (!user || !(await confirmInApp(`Delete ${user.name}'s account permanently?`, "Delete account?"))) return;
  try {
    await api(`/api/admin/users/${id}`, { method: "DELETE" });
    modal.remove();
    admin();
  } catch (error) {
    showNotice(error.message);
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
  clearLocalSession();
  landing();
}
async function boot() {
  if (!token) return landing();
  if (checkIdleSession()) return;
  try {
    me = await api("/api/me");
    dashboard();
  } catch {
    clearLocalSession();
    landing();
  }
}
boot();
