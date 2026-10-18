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
const SESSION_IDLE_MS = 60 * 60 * 1000;
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
const SUPPORT_MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const expireSupportMessages = (data, now = Date.now()) => {
  const conversations = data.supportConversations || [];
  let changed = false;
  for (const conversation of conversations) {
    const activeMessages = (conversation.messages || []).filter((message) => {
      const createdAt = Date.parse(message.createdAt);
      return Number.isFinite(createdAt) && now - createdAt < SUPPORT_MESSAGE_RETENTION_MS;
    });
    if (activeMessages.length !== (conversation.messages || []).length) {
      conversation.messages = activeMessages;
      changed = true;
    }
  }
  const activeConversations = conversations.filter((conversation) => conversation.messages.length > 0);
  if (activeConversations.length !== conversations.length) {
    data.supportConversations = activeConversations;
    changed = true;
  }
  return changed;
};

const sessionUser = async (req) => {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const data = await read();
  const session = data.sessions[token];
  if (!session) return null;

  // Migrate existing string sessions and expire sessions after one hour idle.
  const userId = typeof session === "string" ? session : session.userId;
  const lastActivityAt =
    typeof session === "string" ? Date.now() : session.lastActivityAt;
  const now = Date.now();
  if (!userId || !lastActivityAt || now - lastActivityAt >= SESSION_IDLE_MS) {
    delete data.sessions[token];
    await write(data);
    return null;
  }

  data.sessions[token] = { userId, lastActivityAt: now };
  await write(data);
  return userId;
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
  supportConversations: [],
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
      withdrawalLimit: null,
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
      withdrawalLimit: null,
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
        if (!Array.isArray(data.referralRequests)) {
          data.referralRequests = [];
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
          if (!Array.isArray(user.stakes)) {
            user.stakes = [];
            changed = true;
          }
          if (!user.earnGame) {
            user.earnGame = { level: 1, pendingProfitUsd: 0, rewardCycleBalanceUsd: 0, challenge: null };
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
    (user.stakes || []).reduce(
      (total, stake) => total + Number(stake.amount || 0) * PRICES[stake.symbol],
      0,
    ),
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
        (user.stakes || []).reduce(
          (total, stake) =>
            total + Number(stake.amount || 0) * (market[stake.symbol]?.usd ?? PRICES[stake.symbol] ?? 0),
          0,
        ),
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
        (user.stakes || []).reduce(
          (total, stake) => total + Number(stake.amount || 0) * market[stake.symbol].usd,
          0,
        ),
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
  (user.transactions ||= []).unshift({ id: id(), createdAt: new Date().toISOString(), ...transaction });
const ensureAsset = (user, symbol) => {
  user.assets ||= [];
  let asset = user.assets.find((item) => item.symbol === symbol);
  if (!asset) {
    asset = { symbol, amount: 0 };
    user.assets.push(asset);
  }
  return asset;
};
const addMonths = (date, months) => {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
};
const processMaturedStakes = (user, market) => {
  const now = new Date();
  let changed = false;
  (user.stakes || []).forEach((stake) => {
    const startedAt = new Date(stake.startedAt);
    if (!Number.isFinite(startedAt.getTime())) return;
    let due = Number(stake.maturedMonths || 0) + 1;
    while (addMonths(startedAt, due) <= now) {
      const asset = ensureAsset(user, stake.symbol);
      const reward = Number((Number(stake.amount) * 0.1).toFixed(8));
      if (reward > 0) {
        asset.amount = Number((Number(asset.amount || 0) + reward).toFixed(8));
        addTransaction(user, {
          title: `${stake.symbol} staking reward`,
          subtitle: "Monthly reward · 10% of staked amount",
          asset: stake.symbol,
          amount: `+${reward}`,
          value: moneyValue(reward * (market[stake.symbol]?.usd ?? PRICES[stake.symbol])),
          status: "completed",
        });
      }
      stake.maturedMonths = due;
      due += 1;
      changed = true;
    }
  });
  if (changed) refreshBalanceAtMarket(user, market);
  return changed;
};
const GAME_SYMBOLS = ["₿", "◆", "$", "₮", "⬡", "◈", "Ξ", "◎", "◉", "◇", "△", "⬢", "✦", "◌", "▣", "⬟", "⟠", "◍", "♠", "♥", "♣", "♦", "★", "☆", "☀", "☾", "☯", "⚡", "☘", "⚙", "♜", "♞", "♟", "♛", "♚", "♔", "♕", "♧", "♤", "♡", "♢", "♨", "⚓", "✧", "❖", "⬠", "⬣", "◐", "◑", "◒"];
const MAX_GAME_LEVEL = 50;
const gamePairsForLevel = (level) => level <= 1
  ? 6
  : Math.min(GAME_SYMBOLS.length, Math.round(16 + ((level - 2) / (MAX_GAME_LEVEL - 2)) * (GAME_SYMBOLS.length - 16)));
const gameStateForClient = (game) => ({
  level: game.level,
  maxLevel: MAX_GAME_LEVEL,
  pendingProfitUsd: Number(game.pendingProfitUsd || 0),
  rewardCycleBalanceUsd: Number(game.rewardCycleBalanceUsd || 0),
  payoutThresholdUsd: Number(game.rewardCycleBalanceUsd || 0) * 0.05,
  challenge: game.challenge
    ? {
        id: game.challenge.id,
        level: game.challenge.level,
        pairs: game.challenge.pairs,
        moves: game.challenge.moves,
        matchedIndices: game.challenge.matchedIndices,
        openIndices: game.challenge.openIndices,
        visibleCards: game.challenge.deck.map((symbol, index) =>
          game.challenge.matchedIndices.includes(index) || game.challenge.openIndices.includes(index)
            ? symbol
            : null,
        ),
        completed: game.challenge.completed,
        abandoned: Boolean(game.challenge.abandoned),
        startedAt: game.challenge.startedAt,
        resumedAt: game.challenge.resumedAt || null,
        elapsedMs: Number(game.challenge.elapsedMs || 0),
        lastReward: game.lastReward || null,
      }
    : null,
});
const makeGameDeck = (pairs) => {
  const deck = GAME_SYMBOLS.slice(0, pairs).flatMap((symbol) => [symbol, symbol]);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  return deck;
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
    stakes: [],
    transactions: [],
  };
  data.users.push(user);
  const token = id();
  data.sessions[token] = { userId: user.id, lastActivityAt: Date.now() };
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
  if (!Array.isArray(user.stakes)) user.stakes = [];
  const market = await currentMarketPrices();
  processMaturedStakes(user, market);
  const token = id();
  data.sessions[token] = { userId: user.id, lastActivityAt: Date.now() };
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
app.post("/api/auth/heartbeat", requireUser, (_req, res) => {
  res.json({ ok: true });
});
const publicUser = ({ password, ...user }) => {
  const safeUser = { ...user };
  if (Array.isArray(safeUser.assets)) normalizeBalance(safeUser);
  safeUser.earnGame ||= { level: 1, pendingProfitUsd: 0, rewardCycleBalanceUsd: 0, challenge: null };
  safeUser.earnGame = gameStateForClient(safeUser.earnGame);
  return safeUser;
};
app.get("/api/me", requireUser, async (req, res) => {
  const data = await read();
  const user = data.users.find((u) => u.id === req.userId);
  const market = await currentMarketPrices();
  const rewardsChanged = user ? processMaturedStakes(user, market) : false;
  if (user && Array.isArray(user.assets)) {
    const priorBalance = Number(user.balance || 0);
    const normalized = normalizeBalance(user, market);
    if (rewardsChanged || Math.abs(priorBalance - normalized) >= 0.01) await write(data);
  }
  res.json(publicUser(user));
});
app.get("/api/earn/referrals", requireUser, async (req, res) => {
  const data = await read();
  res.json((data.referralRequests || []).filter((request) => request.referrerId === req.userId));
});
app.post("/api/earn/referrals", requireUser, async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  const data = await read();
  const referrer = data.users.find((user) => user.id === req.userId);
  const referred = data.users.find((user) => user.email.toLowerCase() === email && user.role !== "admin");
  if (!referred) return res.status(404).json({ error: "No account found for that email." });
  if (referred.id === referrer.id) return res.status(400).json({ error: "You cannot refer your own account." });
  data.referralRequests ||= [];
  if (data.referralRequests.some((request) => request.referredId === referred.id))
    return res.status(409).json({ error: "This account already has a referral request." });
  const request = { id: id(), referrerId: referrer.id, referredId: referred.id, referredEmail: referred.email, status: "pending", createdAt: new Date().toISOString() };
  data.referralRequests.unshift(request);
  await write(data);
  res.status(201).json(request);
});
app.get("/api/support/unread", requireUser, async (req, res) => {
  const data = await read();
  if (expireSupportMessages(data)) await write(data);
  const user = data.users.find((entry) => entry.id === req.userId);
  const conversations = data.supportConversations || [];
  if (user?.role === "admin") {
    const adminUnread = conversations.reduce((sum, conversation) => sum + conversation.messages.filter((message) => message.senderRole === "user" && !message.readByAdmin).length, 0);
    return res.json({ userUnread: 0, adminUnread });
  }
  const conversation = conversations.find((entry) => entry.userId === req.userId);
  const userUnread = (conversation?.messages || []).filter((message) => message.senderRole === "admin" && !message.readByUser).length;
  res.json({ userUnread, adminUnread: 0 });
});
app.get("/api/support/conversation", requireUser, async (req, res) => {
  const data = await read();
  data.supportConversations ||= [];
  let changed = expireSupportMessages(data);
  const conversation = data.supportConversations.find((entry) => entry.userId === req.userId) || null;
  (conversation?.messages || []).forEach((message) => {
    if (message.senderRole === "admin" && !message.readByUser) {
      message.readByUser = true;
      changed = true;
    }
  });
  if (changed) await write(data);
  res.json({ conversation });
});
app.post("/api/support/messages", requireUser, async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 2000)
    return res.status(400).json({ error: "Write a message of up to 2,000 characters." });
  const data = await read();
  expireSupportMessages(data);
  const user = data.users.find((entry) => entry.id === req.userId);
  data.supportConversations ||= [];
  let conversation = data.supportConversations.find((entry) => entry.userId === req.userId);
  const now = new Date().toISOString();
  if (!conversation) {
    conversation = { id: id(), userId: user.id, createdAt: now, updatedAt: now, messages: [] };
    data.supportConversations.push(conversation);
  }
  conversation.messages.push({
    id: id(), senderId: user.id, senderRole: "user", senderName: user.name,
    text, createdAt: now, readByUser: true, readByAdmin: false,
  });
  conversation.updatedAt = now;
  await write(data);
  res.json({ conversation });
});
app.get("/api/admin/support", requireAdmin, async (_req, res) => {
  const data = await read();
  if (expireSupportMessages(data)) await write(data);
  const conversations = (data.supportConversations || []).map((conversation) => {
    const user = data.users.find((entry) => entry.id === conversation.userId);
    const lastMessage = conversation.messages.at(-1) || null;
    return {
      id: conversation.id,
      userId: conversation.userId,
      user: user ? { name: user.name, email: user.email } : { name: "Deleted account", email: "" },
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      lastMessage: lastMessage ? { text: lastMessage.text, senderRole: lastMessage.senderRole, createdAt: lastMessage.createdAt } : null,
      unreadCount: conversation.messages.filter((message) => message.senderRole === "user" && !message.readByAdmin).length,
    };
  }).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt));
  res.json(conversations);
});
app.get("/api/admin/support/:id", requireAdmin, async (req, res) => {
  const data = await read();
  let changed = expireSupportMessages(data);
  const conversation = (data.supportConversations || []).find((entry) => entry.id === req.params.id);
  if (!conversation) return res.status(404).json({ error: "Support conversation not found." });
  conversation.messages.forEach((message) => {
    if (message.senderRole === "user" && !message.readByAdmin) {
      message.readByAdmin = true;
      changed = true;
    }
  });
  if (changed) await write(data);
  const user = data.users.find((entry) => entry.id === conversation.userId);
  res.json({ conversation, user: user ? { name: user.name, email: user.email } : { name: "Deleted account", email: "" } });
});
app.post("/api/admin/support/:id/messages", requireAdmin, async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 2000)
    return res.status(400).json({ error: "Write a message of up to 2,000 characters." });
  const data = await read();
  expireSupportMessages(data);
  const conversation = (data.supportConversations || []).find((entry) => entry.id === req.params.id);
  if (!conversation) return res.status(404).json({ error: "Support conversation not found." });
  const admin = data.users.find((entry) => entry.id === req.userId);
  const now = new Date().toISOString();
  conversation.messages.push({
    id: id(), senderId: admin.id, senderRole: "admin", senderName: admin.name,
    text, createdAt: now, readByUser: false, readByAdmin: true,
  });
  conversation.updatedAt = now;
  await write(data);
  res.json({ conversation });
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
    const session = data.sessions[token];
    if ((typeof session === "string" ? session : session.userId) === req.params.id)
      delete data.sessions[token];
  });
  data.depositRequests = data.depositRequests.filter(
    (request) => request.userId !== req.params.id,
  );
  data.withdrawalRequests = data.withdrawalRequests.filter(
    (request) => request.userId !== req.params.id,
  );
  data.supportConversations = (data.supportConversations || []).filter(
    (conversation) => conversation.userId !== req.params.id,
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
  const allowed = ["name", "email", "balance", "change", "verified", "withdrawalLimit"];
  allowed.forEach((key) => {
    if (req.body[key] === undefined) return;
    if (key === "withdrawalLimit") {
      const parsed = req.body[key];
      user[key] = parsed === null || parsed === "" || Number(parsed) <= 0 ? null : Number(parsed);
      return;
    }
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
app.post("/api/admin/users/:id/bonus", requireAdmin, async (req, res) => {
  const amount = Number(req.body.amount);
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  const data = await read();
  const user = data.users.find((entry) => entry.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 1_000_000)
    return res.status(400).json({ error: "Enter a bonus amount between $0.01 and $1,000,000." });
  if (reason.length < 3 || reason.length > 250)
    return res.status(400).json({ error: "Enter a reason between 3 and 250 characters." });

  const stablecoin = ensureAsset(user, "USDC");
  stablecoin.amount = Number((Number(stablecoin.amount || 0) + amount).toFixed(2));
  refreshBalance(user);
  addTransaction(user, {
    title: "Game bonus",
    subtitle: reason,
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
app.get("/api/admin/referrals", requireAdmin, async (_req, res) => {
  const data = await read();
  res.json((data.referralRequests || []).map((request) => ({
    ...request,
    referrer: (() => { const user = data.users.find((entry) => entry.id === request.referrerId); return user ? { id: user.id, name: user.name, email: user.email } : null; })(),
    referred: (() => { const user = data.users.find((entry) => entry.id === request.referredId); return user ? { id: user.id, name: user.name, email: user.email } : null; })(),
  })));
});
app.patch("/api/admin/referrals/:id", requireAdmin, async (req, res) => {
  const action = req.body.action;
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Choose approve or reject." });
  const data = await read();
  const request = (data.referralRequests || []).find((entry) => entry.id === req.params.id);
  if (!request) return res.status(404).json({ error: "Referral request not found." });
  if (request.status !== "pending") return res.status(409).json({ error: "This referral request has already been reviewed." });
  if (action === "approve") {
    const referrer = data.users.find((user) => user.id === request.referrerId);
    const referred = data.users.find((user) => user.id === request.referredId);
    if (!referrer || !referred) return res.status(404).json({ error: "A referred account could not be found." });
    for (const [user, amount, subtitle] of [[referrer, 18, "Referral reward"], [referred, 9, "Referral welcome reward"]]) {
      const stablecoin = ensureAsset(user, "USDC");
      stablecoin.amount = Number((Number(stablecoin.amount || 0) + amount).toFixed(2));
      refreshBalance(user);
      addTransaction(user, { title: "Referral bonus", subtitle, asset: "USDC", amount: `+${amount.toFixed(2)}`, value: moneyValue(amount), status: "completed" });
    }
  }
  request.status = action === "approve" ? "approved" : "rejected";
  request.reviewedAt = new Date().toISOString();
  request.reviewedBy = req.userId;
  await write(data);
  res.json(request);
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
        createdAt: new Date().toISOString(),
      });
  } else
    transaction &&
      Object.assign(transaction, {
        title: "Deposit cancelled",
        subtitle: "Cancelled",
        status: "cancelled",
        createdAt: new Date().toISOString(),
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
      title: request.destinationType === "bank" ? "USDC bank transfer sent" : `Sent ${request.symbol}`,
      subtitle: request.destinationType === "bank"
        ? "Bank transfer marked sent"
        : `Confirmed on blockchain · To ${request.address.slice(0, 6)}…${request.address.slice(-4)}`,
      status: "completed",
      createdAt: new Date().toISOString(),
    });
  } else
    Object.assign(transaction, {
      title: "Send cancelled",
      subtitle: "Cancelled",
      status: "cancelled",
      createdAt: new Date().toISOString(),
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
    destinationType = req.body.destinationType === "bank" ? "bank" : "wallet",
    submittedBankAccount = req.body.bankAccount || {},
    value = Number(amount);
  const bankField = (field) =>
    typeof field === "string" ? field.trim() : "";
  const bankAccount = {
    country: bankField(submittedBankAccount.country),
    accountName: bankField(submittedBankAccount.accountName),
    bankName: bankField(submittedBankAccount.bankName),
    accountNumber: bankField(submittedBankAccount.accountNumber),
    bankCode: bankField(submittedBankAccount.bankCode),
  };
  if (destinationType === "bank" && symbol !== "USDC")
    return res.status(400).json({ error: "Bank transfers are available for USDC only." });
  if (
    !PRICES[symbol] ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (destinationType === "wallet" && (typeof address !== "string" || !address.trim())) ||
    (destinationType === "bank" && Object.values(bankAccount).some((field) => !field)) ||
    Object.values(bankAccount).some((field) => field.length > 200) ||
    (destinationType === "wallet" && req.body.destinationType && req.body.destinationType !== "wallet")
  )
    return res
      .status(400)
      .json({ error: destinationType === "bank" ? "Enter complete bank details and a valid USDC amount." : "Enter a wallet address, asset, and valid amount." });
  const data = await read(),
    user = data.users.find((u) => u.id === req.userId),
    asset = user.assets.find((a) => a.symbol === symbol),
    market = await currentMarketPrices();
  if (asset.amount < value)
    return res.status(400).json({ error: `Insufficient ${symbol} balance.` });
  const balanceValueUsd = Number(user.balance || 0);
  if (
    user.withdrawalLimit != null &&
    Number(user.withdrawalLimit) >= 0 &&
    balanceValueUsd < Number(user.withdrawalLimit)
  )
    return res.status(400).json({
      error: `Your total balance must reach ${moneyValue(Number(user.withdrawalLimit))} before withdrawal is allowed.`,
    });
  const request = {
    id: id(),
    userId: user.id,
    symbol,
    amount: value,
    destinationType,
    ...(destinationType === "bank" ? { bankAccount } : { address: address.trim() }),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  data.withdrawalRequests.unshift(request);
  addTransaction(user, {
    withdrawalId: request.id,
    title: destinationType === "bank" ? "Bank transfer requested" : "Send requested",
    subtitle: destinationType === "bank"
      ? "Awaiting review · USDC bank transfer"
      : `Awaiting blockchain confirmation · To ${request.address.slice(0, 6)}…${request.address.slice(-4)}`,
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
app.post("/api/earn/stakes", requireUser, async (req, res) => {
  const { symbol } = req.body;
  const amount = Number(req.body.amount);
  if (!PRICES[symbol] || !Number.isFinite(amount) || amount < 0.0000001)
    return res.status(400).json({ error: "Choose a valid asset and amount to stake." });

  const data = await read();
  const user = data.users.find((entry) => entry.id === req.userId);
  const market = await currentMarketPrices();
  user.stakes ||= [];
  processMaturedStakes(user, market);
  const totalValue = normalizeBalance(user, market);
  if (totalValue < 2000)
    return res.status(403).json({ error: "Your Vault balance must be at least $2,000 to start staking." });

  const asset = ensureAsset(user, symbol);
  if (amount > Number(asset.amount || 0) + 1e-10)
    return res.status(400).json({ error: `You have ${asset.amount} ${symbol} available to stake.` });

  asset.amount = Number((Number(asset.amount) - amount).toFixed(8));
  const stake = {
    id: id(),
    symbol,
    amount: Number(amount.toFixed(8)),
    startedAt: new Date().toISOString(),
    maturedMonths: 0,
  };
  user.stakes.unshift(stake);
  refreshBalanceAtMarket(user, market);
  addTransaction(user, {
    title: `Staked ${symbol}`,
    subtitle: "Staking position opened",
    asset: symbol,
    amount: `-${stake.amount}`,
    value: moneyValue(stake.amount * market[symbol].usd),
    status: "completed",
  });
  await write(data);
  res.json(publicUser(user));
});
app.delete("/api/earn/stakes/:id", requireUser, async (req, res) => {
  const data = await read();
  const user = data.users.find((entry) => entry.id === req.userId);
  const market = await currentMarketPrices();
  user.stakes ||= [];
  processMaturedStakes(user, market);
  const stakeIndex = user.stakes.findIndex((entry) => entry.id === req.params.id);
  if (stakeIndex === -1)
    return res.status(404).json({ error: "This staking position was not found." });

  const [stake] = user.stakes.splice(stakeIndex, 1);
  const asset = ensureAsset(user, stake.symbol);
  asset.amount = Number((Number(asset.amount || 0) + Number(stake.amount)).toFixed(8));
  refreshBalanceAtMarket(user, market);
  addTransaction(user, {
    title: `Unstaked ${stake.symbol}`,
    subtitle: "Principal returned to available balance",
    asset: stake.symbol,
    amount: `+${stake.amount}`,
    value: moneyValue(stake.amount * market[stake.symbol].usd),
    status: "completed",
  });
  await write(data);
  res.json(publicUser(user));
});
app.post("/api/earn/game/start", requireUser, async (req, res) => {
  const data = await read();
  const user = data.users.find((entry) => entry.id === req.userId);
  user.earnGame ||= { level: 1, pendingProfitUsd: 0, rewardCycleBalanceUsd: 0, challenge: null };
  let challenge = user.earnGame.challenge;
  const expired = challenge && Date.now() - new Date(challenge.startedAt).getTime() > 24 * 60 * 60 * 1000;
  if (!challenge || challenge.completed || challenge.abandoned || expired) {
    const level = Math.max(1, Math.min(MAX_GAME_LEVEL, Number(user.earnGame.level) || 1));
    const pairs = gamePairsForLevel(level);
    challenge = {
      id: id(),
      level,
      pairs,
      deck: makeGameDeck(pairs),
      moves: 0,
      matchedIndices: [],
      openIndices: [],
      lockUntil: 0,
      startedAt: new Date().toISOString(),
      resumedAt: new Date().toISOString(),
      elapsedMs: 0,
      completed: false,
    };
    user.earnGame.challenge = challenge;
    await write(data);
  } else if (!challenge.resumedAt) {
    challenge.elapsedMs = Number(challenge.elapsedMs || 0);
    challenge.resumedAt = new Date().toISOString();
    await write(data);
  }
  res.json({ game: gameStateForClient(user.earnGame) });
});
app.post("/api/earn/game/quit", requireUser, async (req, res) => {
  const data = await read();
  const user = data.users.find((entry) => entry.id === req.userId);
  const challenge = user?.earnGame?.challenge;
  if (!challenge || challenge.id !== req.body.challengeId || challenge.completed || challenge.abandoned)
    return res.status(409).json({ error: "This puzzle round is no longer active." });
  if (challenge.resumedAt) {
    challenge.elapsedMs = Number(challenge.elapsedMs || 0) + Math.max(0, Date.now() - new Date(challenge.resumedAt).getTime());
  }
  challenge.resumedAt = null;
  challenge.abandoned = true;
  challenge.abandonedAt = new Date().toISOString();
  await write(data);
  res.json({ user: publicUser(user) });
});
app.post("/api/earn/game/flip", requireUser, async (req, res) => {
  const { challengeId } = req.body;
  const index = Number(req.body.index);
  const data = await read();
  const user = data.users.find((entry) => entry.id === req.userId);
  const game = user.earnGame;
  const challenge = game?.challenge;
  if (!challenge || challenge.id !== challengeId || challenge.completed || challenge.abandoned)
    return res.status(409).json({ error: "Start a new puzzle round to continue." });
  if (!challenge.resumedAt)
    return res.status(409).json({ error: "Resume this puzzle round before choosing a tile." });
  if (Date.now() - new Date(challenge.startedAt).getTime() > 24 * 60 * 60 * 1000)
    return res.status(410).json({ error: "This puzzle round expired. Start a new round." });
  if (!Number.isInteger(index) || index < 0 || index >= challenge.deck.length)
    return res.status(400).json({ error: "Choose a valid puzzle tile." });
  if (challenge.lockUntil > Date.now())
    return res.status(429).json({ error: "Wait for the tiles to turn over before choosing again." });
  if (challenge.matchedIndices.includes(index) || challenge.openIndices.includes(index))
    return res.status(400).json({ error: "That tile is already open." });

  if (challenge.openIndices.length === 0) {
    challenge.openIndices = [index];
    await write(data);
    return res.json({
      selected: { index, symbol: challenge.deck[index] },
      game: gameStateForClient(game),
    });
  }

  const firstIndex = challenge.openIndices[0];
  const match = challenge.deck[firstIndex] === challenge.deck[index];
  challenge.openIndices = [];
  challenge.moves += 1;
  if (match) challenge.matchedIndices.push(firstIndex, index);
  else challenge.lockUntil = Date.now() + 750;

  let result = null;
  if (challenge.matchedIndices.length === challenge.deck.length) {
    challenge.completed = true;
    challenge.completedAt = new Date().toISOString();
    const elapsedMs = Number(challenge.elapsedMs || 0) + Math.max(0, Date.now() - new Date(challenge.resumedAt).getTime());
    challenge.elapsedMs = elapsedMs;
    challenge.resumedAt = null;
    const elapsedSeconds = Math.max(1, elapsedMs / 1000);
    const parSeconds = challenge.pairs * 8 + 20;
    const speedMultiplier = Math.min(1.5, Math.max(0.25, parSeconds / elapsedSeconds));
    const moveMultiplier = Math.max(0.25, Math.min(1, challenge.pairs / Math.max(challenge.pairs, challenge.moves)));
    const accountBalance = normalizeBalance(user, await currentMarketPrices());
    let rewardUsd = 0;
    let payoutUsd = 0;
    let rewardRatePercent = 0;
    if (accountBalance > 0) {
      if (!(Number(game.rewardCycleBalanceUsd) > 0)) game.rewardCycleBalanceUsd = accountBalance;
      const cycleCap = Number(game.rewardCycleBalanceUsd) * 0.05;
      rewardRatePercent = 0.05 * challenge.level * speedMultiplier * moveMultiplier;
      rewardUsd = Number((Number(game.rewardCycleBalanceUsd) * rewardRatePercent / 100).toFixed(8));
      game.pendingProfitUsd = Number(Math.min(cycleCap, Number(game.pendingProfitUsd || 0) + rewardUsd).toFixed(8));
      if (game.pendingProfitUsd + 1e-8 >= cycleCap) {
        payoutUsd = Number(cycleCap.toFixed(8));
        const stablecoin = ensureAsset(user, "USDC");
        stablecoin.amount = Number((Number(stablecoin.amount || 0) + payoutUsd).toFixed(8));
        game.pendingProfitUsd = 0;
        refreshBalanceAtMarket(user, await currentMarketPrices());
        addTransaction(user, {
          title: "Puzzle game reward",
          subtitle: "Game profit threshold reached · credited to USDC",
          asset: "USDC",
          amount: `+${payoutUsd.toFixed(8)}`,
          value: moneyValue(payoutUsd),
          status: "completed",
        });
        game.rewardCycleBalanceUsd = Number(user.balance || 0);
      }
    }
    game.level = Math.min(MAX_GAME_LEVEL, challenge.level + 1);
    game.lastReward = {
      level: challenge.level,
      elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
      moves: challenge.moves,
      speedMultiplier,
      moveMultiplier,
      rewardRatePercent,
      rewardUsd,
      pendingProfitUsd: Number(game.pendingProfitUsd || 0),
      payoutThresholdUsd: Number(game.rewardCycleBalanceUsd || 0) * 0.05,
      payoutUsd,
      completedAt: challenge.completedAt,
    };
    result = game.lastReward;
  }
  await write(data);
  res.json({
    revealed: [
      { index: firstIndex, symbol: challenge.deck[firstIndex] },
      { index, symbol: challenge.deck[index] },
    ],
    match,
    game: gameStateForClient(game),
    result,
    ...(challenge.completed ? { user: publicUser(user) } : {}),
  });
});
const moneyValue = (value) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT || 3000;
  initializeData().then(async () => {
    const accrueMaturedRewards = async () => {
      try {
        const data = await read();
        const market = await currentMarketPrices();
        let changed = false;
        data.users.forEach((user) => {
          if (processMaturedStakes(user, market)) changed = true;
        });
        if (changed) await write(data);
      } catch (error) {
        console.error("Monthly staking accrual failed:", error.message);
      }
    };
    await accrueMaturedRewards();
    setInterval(accrueMaturedRewards, 15 * 60 * 1000).unref();
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
