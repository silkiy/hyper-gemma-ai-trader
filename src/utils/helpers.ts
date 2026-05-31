export const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

export const formatCompactNumber = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value);
};

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const calculatePercentageChange = (oldVal: number, newVal: number) => {
  return ((newVal - oldVal) / oldVal) * 100;
};
