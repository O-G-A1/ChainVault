// import serverless from "serverless-http";
// import { app, initializeData } from "../server.js";

// const handler = serverless(app);

// export default async function vercelHandler(req, res) {
//   await initializeData();
//   return handler(req, res);
// }
import serverless from "serverless-http";
import { app } from "../server.js";

const handler = serverless(app);

export default function vercelHandler(req, res) {
  return handler(req, res);
}
