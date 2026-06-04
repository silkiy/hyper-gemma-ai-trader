import { bitgetClient } from '../exchange/bitget.client.js';
import 'dotenv/config';

async function probe() {
  console.log('--- PROBING LIVE POSITIONS ---');
  try {
    const positions = await bitgetClient.getPositions();
    console.log(JSON.stringify(positions, null, 2));
    
    const accounts = await bitgetClient.getAccountBalance();
    console.log('--- PROBING ACCOUNTS ---');
    console.log(JSON.stringify(accounts, null, 2));
  } catch (e: any) {
    console.error(e.message);
  }
}
probe();
