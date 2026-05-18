import 'dotenv/config';
import { asterdexClient } from '../exchange/asterdex.client.js';
import { logger } from '../utils/logger.js';

async function checkBalance() {
  logger.info('Checking Asterdex account balance...');
  try {
    const balance = await asterdexClient.getAccountBalance();
    console.log('\n--- ASTERDEX BALANCE INFO ---');
    console.log(JSON.stringify(balance, null, 2));
    console.log('-----------------------------\n');
    
    if (Array.isArray(balance)) {
        const usdc = balance.find((b: any) => b.asset === 'USDC' || b.asset === 'USDT');
        if (usdc) {
            logger.info(`✅ Success! Available Balance: ${usdc.availableBalance || usdc.balance} ${usdc.asset}`);
        } else {
            logger.warn('Connected, but no USDC/USDT balance found.');
        }
    }
  } catch (error: any) {
    logger.error('❌ Failed to fetch balance.');
    if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
        console.error('Error:', error.message);
    }
  }
}

checkBalance();
