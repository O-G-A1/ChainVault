import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data.json");

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
  if (SUPABASE_URL && SUPABASE_KEY) {
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
