import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../database/mongo.js';
import { hypothesisTester } from '../utils/hypothesis-tester.js';

async function run() {
  await connectMongo();
  await hypothesisTester.run(false); // Always run and show report when executed manually
  await mongoose.disconnect();
}

run();
