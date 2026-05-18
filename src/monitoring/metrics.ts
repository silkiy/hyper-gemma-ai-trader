import client from 'prom-client';

export const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const tradeCounter = new client.Counter({
  name: 'trader_trades_total',
  help: 'Total number of trades executed',
  labelNames: ['pair', 'action', 'result'],
});

export const pnlGauge = new client.Gauge({
  name: 'trader_pnl_total',
  help: 'Total Profit and Loss',
});

register.registerMetric(tradeCounter);
register.registerMetric(pnlGauge);
