import 'dotenv/config';
import { connectMongo } from '../database/mongo.js';
import { Trade } from '../database/models/trade.model.js';
import mongoose from 'mongoose';

async function diagnose() {
  await connectMongo();
  const lastTrades = await Trade.find({ result: { $exists: true } })
    .sort({ created_at: -1 })
    .limit(10);

  console.log("Last 10 trades in database:");
  for (const t of lastTrades) {
    console.log(`ID: ${t._id}, Pair: ${t.pair}, Result: ${t.result}, PnL: ${t.profit_loss}, CreatedAt: ${t.created_at.toISOString()}`);
  }
  await mongoose.disconnect();
}
diagnose();
