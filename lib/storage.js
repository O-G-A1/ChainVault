import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data.json");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "onchainvault";
const MONGODB_COLL = process.env.MONGODB_COLL || "app_state";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "app_data"; // expects {id: 'main', data: jsonb}
const SUPABASE_ID = process.env.SUPABASE_ID || "main";

async function readData() {
  if (SUPABASE_URL && SUPABASE_KEY) {
    const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(
      SUPABASE_ID,
    )}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
    const rows = await res.json();
    if (rows.length === 0) return null;
    return rows[0].data;
  }
  // fallback to local file
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

async function writeData(data) {
  if (SUPABASE_URL && SUPABASE_KEY) {
    const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`;
    // upsert by sending an array and asking PostgREST to merge duplicates
    const body = [ { id: SUPABASE_ID, data } ];
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase write failed: ${res.status} ${text}`);
    }
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function ensureInitialData(initial) {
  // In production/serverless (VERCEL) we must not attempt to write to the local filesystem.
  // Require a configured remote store (Supabase or MongoDB) in that environment.
  const runningInProd = process.env.VERCEL || process.env.NODE_ENV === "production";
  const hasRemote = SUPABASE_URL && SUPABASE_KEY;
  const hasMongo = !!process.env.MONGODB_URI;

  if (runningInProd) {
    if (hasRemote) {
      const existing = await readData();
      if (existing === null) await writeData(initial);
      return;
    }
    if (hasMongo) {
      // In our deployment we use a separate mongo-backed module; when MONGODB_URI is
      // set the mongo-backed storage will be used instead. Here we simply return so
      // the mongo module can initialize itself where appropriate.
      return;
    }
    throw new Error(
      "No persistent storage configured for production. Set MONGODB_URI or SUPABASE_URL/SUPABASE_KEY in your environment.",
    );
  }

  // Local development fallback: write the file if it doesn't exist.
  if (hasRemote) {
    const existing = await readData();
    if (existing === null) {
      await writeData(initial);
    }
    return;
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

export { readData, writeData, ensureInitialData };
