import express from "express";
import cors from "cors";
import { grantsRouter } from "./routes/grants.js";
import { tokensRouter } from "./routes/tokens.js";
import { proxyRouter } from "./routes/proxy.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Mount routes
app.use("/", grantsRouter());
app.use("/", tokensRouter());
app.use("/", proxyRouter());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "aipassport-broker" });
});

export default app;
