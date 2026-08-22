import { MongoClient } from "mongodb";

(async function () {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI in the environment before running this script.");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const dbName = process.env.MONGODB_DB || "onchainvault";
    const collName = process.env.MONGODB_COLL || "app_state";
    const db = client.db(dbName);
    // Try a harmless read
    await db.collection(collName).findOne({ _id: "main" });
    console.log("MongoDB connection OK — able to reach collection:", `${dbName}.${collName}`);
    process.exit(0);
  } catch (err) {
    console.error("MongoDB connection failed:", err.message || err);
    process.exit(2);
  } finally {
    await client.close();
  }
})();
