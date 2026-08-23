import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is missing");
}

const client = new MongoClient(uri);

try {
  await client.connect();

  await client.db("admin").command({ ping: 1 });

  console.log("✅ MongoDB connection successful!");

  const db = client.db(process.env.MONGODB_DB || "onchainvault");
  const collection = db.collection(process.env.MONGODB_COLL || "app_state");

  console.log("Database:", db.databaseName);
  console.log("Collection:", collection.collectionName);
} catch (error) {
  console.error("❌ MongoDB connection failed:");
  console.error(error);
} finally {
  await client.close();
}
