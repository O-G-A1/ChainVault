import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data.json");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || "onchainvault";
const MONGODB_COLL = process.env.MONGODB_COLL || "app_state";

let _dbClient;
async function getDb() {
  if (!MONGODB_URI) {
    // In serverless production environments (like Vercel) the filesystem is ephemeral
    // and we require a real MongoDB connection. Throw a clear error to aid debugging.
    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      throw new Error(
        "MONGODB_URI is not set. Set MONGODB_URI in your environment (e.g., Vercel Project > Settings > Environment Variables).",
      );
    }
    return null;
  }
  if (globalThis.__mongoClient) return globalThis.__mongoClient.db(MONGODB_DB);
  _dbClient = new MongoClient(MONGODB_URI);
  await _dbClient.connect();
  globalThis.__mongoClient = _dbClient;
  return _dbClient.db(MONGODB_DB);
}

async function readData() {
  const db = await getDb();
  if (db) {
    const coll = db.collection(MONGODB_COLL);
    const doc = await coll.findOne({ _id: "main" });
    return doc ? doc.data : null;
  }
  // fallback to local file
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

async function writeData(data) {
  const db = await getDb();
  if (db) {
    const coll = db.collection(MONGODB_COLL);
    await coll.updateOne({ _id: "main" }, { $set: { data } }, { upsert: true });
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function ensureInitialData(initial) {
  const db = await getDb();
  if (db) {
    const coll = db.collection(MONGODB_COLL);
    const existing = await coll.findOne({ _id: "main" });
    if (!existing) await coll.insertOne({ _id: "main", data: initial });
    return;
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

export { readData, writeData, ensureInitialData };
