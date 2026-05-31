import 'dotenv/config';
import { bitgetClient } from '../exchange/bitget.client.js';
import { logger } from '../utils/logger.js';

async function checkBalance() {
  logger.info('Checking Bitget account balance...');
  try {
    const balances = await bitgetClient.getAccountBalance();
    console.log('\n--- BITGET BALANCE INFO ---');
    console.log(JSON.stringify(balances, null, 2));
    console.log('-----------------------------\n');
    
    if (Array.isArray(balances)) {
        const usdt = balances.find((b: any) => b.marginCoin === 'USDT');
        if (usdt) {
            logger.info(`✅ Success! Available Balance: ${usdt.available} USDT`);
        } else {
            logger.warn('Connected, but no USDT margin account found.');
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
