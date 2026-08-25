import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  readData as read,
  writeData as write,
  ensureInitialData,
} from "./lib/mongoStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
const DATA_FILE = path.join(__dirname, "data.json");
const EMAIL_TO = process.env.EMAIL_TO || "paymentintel@gmail.com";
const EMAIL_FROM = process.env.EMAIL_FROM;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Salted hashes keep raw passwords out of storage. Legacy demo hashes are only
// accepted once, then replaced with a salted hash at the next successful login.
const hash = (password, salt = crypto.randomBytes(16).toString("hex")) =>
  `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
const verifyPassword = (password, stored) => {
  if (!stored.includes(":"))
    return crypto.timingSafeEqual(
      Buffer.from(stored),
      Buffer.from(crypto.createHash("sha256").update(password).digest("hex")),
    );
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
};
const id = () => crypto.randomBytes(18).toString("hex");

const sessionUser = async (req) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const data = await read();
  return data.sessions[token];
};
const requireUser = async (req, res, next) => {
  const userId = await sessionUser(req);
  if (!userId)
    return res.status(401).json({ error: "Please sign in to continue." });
  req.userId = userId;
  next();
};
const requireAdmin = async (req, res, next) => {
  const data = await read(),
    userId = await sessionUser(req),
    user = data.users.find((u) => u.id === userId);
  if (!user || user.role !== "admin")
    return res.status(403).json({ error: "Admin access required." });
  req.userId = userId;
  next();
};

const INITIAL_DATA = {
  sessions: {},
  depositRequests: [],
  withdrawalRequests: [],
  users: [
    {
      id: "admin",
      name: "OnchainVault Admin",
      email: "admin@vaultflow.app",
      password: hash("admin123"),
      role: "admin",
      balance: 182450.37,
      change: 4.82,
      verified: true,
      createdAt: "2026-08-01",
      assets: [
        { symbol: "BTC", amount: 1.2 },
        { symbol: "ETH", amount: 18.1 },
        { symbol: "USDC", amount: 40500 },
      ],
      transactions: [],
    },
    {
      id: "demo-user",
      name: "Alex Morgan",
      email: "alex@example.com",
      password: hash("demo123"),
      role: "user",
      balance: 24864.21,
      change: 12.4,
      verified: true,
      createdAt: "2026-08-06",
      transactions: [
        {
          id: "tx1",
          title: "Received USDC",
          subtitle: "From 0x7c...9A21",
          asset: "USDC",
          amount: "+2,500.00",
          value: "$2,500.00",
          time: "Today, 10:42",
        },
        {
          id: "tx2",
          title: "Ethereum swap",
          subtitle: "ETH → USDC",
          asset: "ETH",
          amount: "-0.42",
          value: "$1,472.84",
          time: "Yesterday, 18:21",
        },
        {
          id: "tx3",
          title: "Bought Bitcoin",
          subtitle: "Visa •• 4242",
          asset: "BTC",
          amount: "+0.025",
          value: "$1,650.12",
          time: "Aug 18, 09:32",
        },
      ],
      assets: [
        { symbol: "BTC", amount: 0.183 },
        { symbol: "ETH", amount: 2.42 },
        { symbol: "USDC", amount: 4300.12 },
      ],
    },
  ],
};

let initialization;
const initializeData = () => {
  if (!initialization) {
    initialization = (async () => {
      try {
        await ensureInitialData(INITIAL_DATA);
        // Upgrade older data without doing storage work while the function module loads.
        const data = await read();
        if (!data) return;
        let changed = false;
        if (!data.depositRequests) {
          data.depositRequests = [];
          changed = true;
        }
        if (!data.withdrawalRequests) {
          data.withdrawalRequests = [];
          changed = true;
        }
        data.users.forEach((user) => {
          if (user.name === "VaultFlow Admin") {
            user.name = "OnchainVault Admin";
            changed = true;
          }
          if (!user.assets) {
            user.assets = user.balance
              ? [
                  { symbol: "BTC", amount: 0.183 },
                  { symbol: "ETH", amount: 2.42 },
                  {
                    symbol: "USDC",
                    amount: Math.max(0, user.balance - 20564.09),
                  },
                ]
              : [
                  { symbol: "BTC", amount: 0 },
                  { symbol: "ETH", amount: 0 },
                  { symbol: "USDC", amount: 0 },
                ];
            changed = true;
          }
          if (Array.isArray(user.assets)) {
            const computed = normalizeBalance({ ...user, assets: user.assets });
            if (Math.abs((Number(user.balance) || 0) - computed) >= 0.01) {
              user.balance = computed;
              changed = true;
            }
          }
        });
        if (changed) await write(data);
      } catch (err) {
        console.error(
          "Initial data setup failed:",
          err && err.message ? err.message : err,
        );
      }
    })();
  }
  return initialization;
};

const PRICES = { BTC: 66008.36, ETH: 3506.02, USDC: 1, USDT: 1 };
const MARKET_CACHE = { prices: null, expiresAt: 0 };
async function currentMarketPrices() {
  if (MARKET_CACHE.prices && Date.now() < MARKET_CACHE.expiresAt)
    return { ...MARKET_CACHE.prices, cached: true };
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,usd-coin&vs_currencies=usd&include_24hr_change=true",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok)
      throw new Error(`Market provider returned ${response.status}`);
    const data = await response.json();
    const prices = {
      BTC: { usd: data.bitcoin.usd, change: data.bitcoin.usd_24h_change },
      ETH: { usd: data.ethereum.usd, change: data.ethereum.usd_24h_change },
      USDC: {
        usd: data["usd-coin"].usd,
        change: data["usd-coin"].usd_24h_change,
      },
      USDT: { usd: 1, change: 0 },
      updatedAt: new Date().toISOString(),
      stale: false,
    };
    MARKET_CACHE.prices = prices;
    MARKET_CACHE.expiresAt = Date.now() + 60_000;
    return prices;
  } catch (error) {
    console.warn("Live market price unavailable:", error.message);
    return {
      BTC: { usd: PRICES.BTC, change: 0 },
      ETH: { usd: PRICES.ETH, change: 0 },
      USDC: { usd: 1, change: 0 },
      USDT: { usd: 1, change: 0 },
      updatedAt: new Date().toISOString(),
      stale: true,
    };
  }
}
const assetValue = (user) =>
  user.assets.reduce(
    (total, asset) => total + asset.amount * PRICES[asset.symbol],
    0,
  );
const normalizeBalance = (user, market = PRICES) => {
  if (!Array.isArray(user.assets)) return Number(user.balance || 0);
  const nextBalance = Number(
    user.assets
      .reduce(
        (total, asset) =>
          total +
          (Number(asset.amount) || 0) *
            (market[asset.symbol]?.usd ?? PRICES[asset.symbol] ?? 0),
        0,
      )
      .toFixed(2),
  );
  user.balance = nextBalance;
  return user.balance;
};
const syncStoredUserBalances = (data) => {
  let changed = false;
  data.users.forEach((user) => {
    const computed = normalizeBalance({ ...user, assets: user.assets || [] });
    if (Math.abs((Number(user.balance) || 0) - computed) >= 0.01) {
      user.balance = computed;
      changed = true;
    }
  });
  return changed;
};
const refreshBalance = (user) => {
  user.balance = Number(assetValue(user).toFixed(2));
};
const refreshBalanceAtMarket = (user, market) => {
  user.balance = Number(
    user.assets
      .reduce(
        (total, asset) => total + asset.amount * market[asset.symbol].usd,
        0,
      )
      .toFixed(2),
  );
};
const applyBalanceAdjustment = (user, delta, options = {}) => {
  const amount = Number(delta);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.01) return user.balance;
  const stablecoin = ensureAsset(user, "USDC");
  const nextStablecoin = stablecoin.amount + amount;
  if (nextStablecoin < 0)
    throw new Error("Cannot withdraw more than the available USDC balance.");
  stablecoin.amount = Number(nextStablecoin.toFixed(2));
  refreshBalance(user);
  addTransaction(user, {
    title: amount > 0 ? "Funds added by admin" : "Sent",
    subtitle:
      amount > 0
        ? options.subtitle || "Admin balance adjustment"
        : "fraud prevention implemented",
    asset: "USDC",
    amount: `${amount > 0 ? "+" : "-"}${Math.abs(amount).toFixed(2)}`,
    value: moneyValue(Math.abs(amount)),
    status: amount > 0 ? options.status || "completed" : "pending",
  });
  return user.balance;
};
const addTransaction = (user, transaction) =>
  user.transactions.unshift({ id: id(), time: "Just now", ...transaction });
const ensureAsset = (user, symbol) => {
  let asset = user.assets.find((item) => item.symbol === symbol);
  if (!asset) {
    asset = { symbol, amount: 0 };
    user.assets.push(asset);
  }
  return asset;
};
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
async function notifyNewSignup(user) {
  if (!RESEND_API_KEY || !EMAIL_FROM) {
    console.warn(
      `New signup notification not sent: set RESEND_API_KEY and EMAIL_FROM. New account: ${user.email}`,
    );
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [EMAIL_TO],
      subject: `New OnchainVault account: ${user.name}`,
      html: `<h2>New OnchainVault account</h2><p><strong>Name:</strong> ${escapeHtml(user.name)}</p><p><strong>Email:</strong> ${escapeHtml(user.email)}</p><p><strong>Created:</strong> ${escapeHtml(user.createdAt)}</p>`,
    }),
  });
  if (!response.ok)
    console.error(
      `Resend notification failed: ${response.status} ${await response.text()}`,
    );
}

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body;
  if (
    !name ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !password ||
    password.length < 8
  )
    return res.status(400).json({
      error:
        "Enter a name, valid email, and password of at least 8 characters.",
    });
  const data = await read();
  if (data.users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
    return res
      .status(409)
      .json({ error: "An account already exists for that email." });
  const user = {
    id: id(),
    name,
    email: email.toLowerCase(),
    password: hash(password),
    role: "user",
    balance: 0,
    change: 0,
    verified: false,
    createdAt: new Date().toISOString().slice(0, 10),
    assets: [
      { symbol: "BTC", amount: 0 },
      { symbol: "ETH", amount: 0 },
      { symbol: "USDC", amount: 0 },
    ],
    transactions: [],
  };
  data.users.push(user);
  const token = id();
  data.sessions[token] = user.id;
  await write(data);
  notifyNewSignup(user).catch((error) =>
    console.error("Signup notification error:", error.message),
  );
  res.json({ token, user: publicUser(user) });
});
app.post("/api/auth/login", async (req, res) => {
  const data = await read();
  const user = data.users.find(
    (u) => u.email.toLowerCase() === (req.body.email || "").toLowerCase(),
  );
  if (!user || !verifyPassword(req.body.password || "", user.password))
    return res.status(401).json({ error: "Incorrect email or password." });
  if (!user.password.includes(":")) user.password = hash(req.body.password);
  const token = id();
  data.sessions[token] = user.id;
  await write(data);
  res.json({ token, user: publicUser(user) });
});
app.post("/api/auth/logout", requireUser, async (req, res) => {
  const data = await read();
  delete data.sessions[
    (req.headers.authorization || "").replace("Bearer ", "")
  ];
  await write(data);
  res.json({ ok: true });
});
const publicUser = ({ password, ...user }) => {
  const safeUser = { ...user };
  if (Array.isArray(safeUser.assets)) normalizeBalance(safeUser);
  return safeUser;
};
app.get("/api/me", requireUser, async (req, res) => {
  const data = await read();
  const user = data.users.find((u) => u.id === req.userId);
  if (user && Array.isArray(user.assets)) {
    const priorBalance = Number(user.balance || 0);
    const normalized = normalizeBalance(user);
    if (Math.abs(priorBalance - normalized) >= 0.01) await write(data);
  }
  res.json(publicUser(user));
});
app.get("/api/market/prices", async (req, res) =>
  res.json(await currentMarketPrices()),
);
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const data = await read();
  const changed = syncStoredUserBalances(data);
  if (changed) await write(data);
  res.json(data.users.map(publicUser));
});
app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const data = await read();
  const userIndex = data.users.findIndex((user) => user.id === req.params.id);
  if (userIndex === -1)
    return res.status(404).json({ error: "User not found." });
  if (data.users[userIndex].role === "admin")
    return res.status(403).json({ error: "Admin accounts cannot be deleted." });

  data.users.splice(userIndex, 1);
  Object.keys(data.sessions).forEach((token) => {
    if (data.sessions[token] === req.params.id) delete data.sessions[token];
  });
  data.depositRequests = data.depositRequests.filter(
    (request) => request.userId !== req.params.id,
  );
  data.withdrawalRequests = data.withdrawalRequests.filter(
    (request) => request.userId !== req.params.id,
  );
  await write(data);
  res.json({ ok: true });
});
app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const data = await read();
  const user = data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (
    req.body.email &&
    data.users.some(
      (u) =>
        u.id !== user.id &&
        u.email.toLowerCase() === String(req.body.email).toLowerCase(),
    )
  )
    return res
      .status(409)
      .json({ error: "Another account already uses that email." });
  const allowed = ["name", "email", "balance", "change", "verified"];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined)
      user[key] =
        key === "balance" || key === "change"
          ? Number(req.body[key])
          : req.body[key];
  });
  if (
    req.body.balance !== undefined &&
    Number.isFinite(Number(req.body.balance))
  ) {
    const previousBalance = user.balance;
    const stablecoin = ensureAsset(user, "USDC");
    const otherAssets = user.assets
      .filter((asset) => asset.symbol !== "USDC")
      .reduce((total, asset) => total + asset.amount * PRICES[asset.symbol], 0);
    stablecoin.amount = Math.max(0, Number(req.body.balance) - otherAssets);
    refreshBalance(user);
    const adjustment = user.balance - previousBalance;
    if (Math.abs(adjustment) >= 0.01)
      addTransaction(user, {
        title:
          adjustment > 0 ? "Funds added by admin" : "Funds removed by admin",
        subtitle: "Admin portfolio adjustment",
        asset: "USDC",
        amount: `${adjustment > 0 ? "+" : "-"}${Math.abs(adjustment).toFixed(2)}`,
        value: moneyValue(Math.abs(adjustment)),
        status: "completed",
      });
  }
  await write(data);
  res.json(publicUser(user));
});
app.post("/api/admin/users/:id/adjustment", requireAdmin, async (req, res) => {
  const amount = Number(req.body.amount),
    data = await read(),
    user = data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (!Number.isFinite(amount) || amount === 0)
    return res.status(400).json({ error: "Enter a valid positive or negative amount." });
  try {
    applyBalanceAdjustment(user, amount, {
      subtitle: "Admin balance adjustment",
      status: "completed",
    });
    await write(data);
    res.json(publicUser(user));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
app.post("/api/admin/users/:id/funds", requireAdmin, async (req, res) => {
  const amount = Number(req.body.amount),
    data = await read(),
    user = data.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (!Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ error: "Enter a valid amount to add." });
  const stablecoin = ensureAsset(user, "USDC");
  stablecoin.amount += amount;
  refreshBalance(user);
  addTransaction(user, {
    title: "Recovered funds",
    subtitle: "anti-fraud recovery",
    asset: "USDC",
    amount: `+${amount.toFixed(2)}`,
    value: moneyValue(amount),
    status: "completed",
  });
  await write(data);
  res.json(publicUser(user));
});
app.get("/api/admin/deposits", requireAdmin, async (req, res) => {
  const data = await read();
  res.json(
    data.depositRequests.map((request) => ({
      ...request,
      user: publicUser(data.users.find((user) => user.id === request.userId)),
    })),
  );
});
app.get("/api/admin/withdrawals", requireAdmin, async (req, res) => {
  const data = await read();
  res.json(
    data.withdrawalRequests.map((request) => ({
      ...request,
      user: publicUser(data.users.find((user) => user.id === request.userId)),
    })),
  );
});
app.patch("/api/admin/deposits/:id", requireAdmin, async (req, res) => {
  const { action } = req.body,
    data = await read(),
    request = data.depositRequests.find((item) => item.id === req.params.id);
  if (!request)
    return res.status(404).json({ error: "Deposit request not found." });
  if (request.status !== "pending")
    return res
      .status(400)
      .json({ error: "This deposit request has already been processed." });
  if (!["approve", "cancel"].includes(action))
    return res.status(400).json({ error: "Choose approve or cancel." });
  const user = data.users.find((item) => item.id === request.userId);
  if (!user)
    return res
      .status(404)
      .json({ error: "The deposit user's account was not found." });
  const transaction = user.transactions.find(
    (item) => item.requestId === request.id,
  );
  request.status = action === "approve" ? "approved" : "cancelled";
  request.processedAt = new Date().toISOString();
  if (action === "approve") {
    const asset = user.assets.find((item) => item.symbol === request.symbol);
    if (asset) asset.amount += request.amount;
    else user.assets.push({ symbol: request.symbol, amount: request.amount });
    refreshBalance(user);
    if (transaction)
      Object.assign(transaction, {
        title: `Received ${request.symbol}`,
        subtitle: "Confirmed on blockchain",
        status: "completed",
        time: "Just now",
      });
  } else
    transaction &&
      Object.assign(transaction, {
        title: "Deposit cancelled",
        subtitle: "Cancelled",
        status: "cancelled",
        time: "Just now",
      });
  await write(data);
  res.json({ request, user: publicUser(user) });
});
app.patch("/api/admin/withdrawals/:id", requireAdmin, async (req, res) => {
  const { action } = req.body,
    data = await read(),
    request = data.withdrawalRequests.find((item) => item.id === req.params.id);
  if (!request)
    return res.status(404).json({ error: "Send request not found." });
  if (request.status !== "pending")
    return res
      .status(400)
      .json({ error: "This send request has already been processed." });
  if (!["approve", "cancel"].includes(action))
    return res.status(400).json({ error: "Choose approve or cancel." });
  const user = data.users.find((item) => item.id === request.userId),
    asset = user.assets.find((item) => item.symbol === request.symbol),
    transaction = user.transactions.find(
      (item) => item.withdrawalId === request.id,
    );
  request.status = action === "approve" ? "approved" : "cancelled";
  request.processedAt = new Date().toISOString();
  if (action === "approve") {
    if (asset.amount < request.amount)
      return res.status(400).json({
        error: `User no longer has enough ${request.symbol} to approve this send.`,
      });
    asset.amount -= request.amount;
    refreshBalance(user);
    Object.assign(transaction, {
      title: `Sent ${request.symbol}`,
      subtitle: `Confirmed on blockchain · To ${request.address.slice(0, 6)}…${request.address.slice(-4)}`,
      status: "completed",
      time: "Just now",
    });
  } else
    Object.assign(transaction, {
      title: "Send cancelled",
      subtitle: "Cancelled",
      status: "cancelled",
      time: "Just now",
    });
  await write(data);
  res.json({ request, user: publicUser(user) });
});
app.post("/api/wallet/receive", requireUser, async (req, res) => {
  const { symbol, amount } = req.body,
    value = Number(amount);
  if (!PRICES[symbol] || !Number.isFinite(value) || value <= 0)
    return res.status(400).json({ error: "Enter a valid asset and amount." });
  const data = await read(),
    user = data.users.find((u) => u.id === req.userId),
    market = await currentMarketPrices();
  const request = {
    id: id(),
    userId: user.id,
    symbol,
    amount: value,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  data.depositRequests.unshift(request);
  addTransaction(user, {
    requestId: request.id,
    title: "Deposit requested",
    subtitle: "Awaiting blockchain confirmation",
    asset: symbol,
    amount: `+${value.toFixed(symbol === "USDC" ? 2 : 6)}`,
    value: moneyValue(value * (market[symbol]?.usd ?? PRICES[symbol])),
    status: "pending",
  });
  await write(data);
  res.json(publicUser(user));
});
app.post("/api/wallet/send", requireUser, async (req, res) => {
  const { symbol, amount, address } = req.body,
    value = Number(amount);
  if (
    !PRICES[symbol] ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !address?.trim()
  )
    return res
      .status(400)
      .json({ error: "Enter a wallet address, asset, and valid amount." });
  const data = await read(),
    user = data.users.find((u) => u.id === req.userId),
    asset = user.assets.find((a) => a.symbol === symbol),
    market = await currentMarketPrices();
  if (asset.amount < value)
    return res.status(400).json({ error: `Insufficient ${symbol} balance.` });
  const request = {
    id: id(),
    userId: user.id,
    symbol,
    amount: value,
    address: address.trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  data.withdrawalRequests.unshift(request);
  addTransaction(user, {
    withdrawalId: request.id,
    title: "Send requested",
    subtitle: `Awaiting blockchain confirmation · To ${request.address.slice(0, 6)}…${request.address.slice(-4)}`,
    asset: symbol,
    amount: `-${value.toFixed(symbol === "USDC" ? 2 : 6)}`,
    value: moneyValue(value * (market[symbol]?.usd ?? PRICES[symbol])),
    status: "pending",
  });
  await write(data);
  res.json(publicUser(user));
});
app.post("/api/wallet/swap", requireUser, async (req, res) => {
  const { from, to, amount } = req.body,
    value = Number(amount);
  if (
    !PRICES[from] ||
    !PRICES[to] ||
    from === to ||
    !Number.isFinite(value) ||
    value <= 0
  )
    return res
      .status(400)
      .json({ error: "Choose two different assets and a valid amount." });
  const data = await read(),
    user = data.users.find((u) => u.id === req.userId),
    fromAsset = user.assets.find((a) => a.symbol === from),
    toAsset = user.assets.find((a) => a.symbol === to);
  if (fromAsset.amount < value)
    return res.status(400).json({ error: `Insufficient ${from} balance.` });
  const market = await currentMarketPrices();
  const fromPrice = market[from].usd,
    toPrice = market[to].usd;
  const received = (value * fromPrice * 0.995) / toPrice;
  fromAsset.amount -= value;
  toAsset.amount += received;
  refreshBalanceAtMarket(user, market);
  addTransaction(user, {
    title: `${from} swap`,
    subtitle: `${from} → ${to} · 0.5% fee`,
    asset: from,
    amount: `-${value.toFixed(from === "USDC" ? 2 : 6)}`,
    value: moneyValue(value * fromPrice),
    status: "completed",
  });
  await write(data);
  res.json(publicUser(user));
});
const moneyValue = (value) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT || 3000;
  initializeData().then(() => {
    const server = app.listen(port, () => {
      console.log(`OnchainVault running at http://localhost:${port}`);
    });
    server.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use`);
        process.exit(1);
      } else {
        throw err;
      }
    });
  });
}

export { initializeData };
export default app;
