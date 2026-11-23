// Public Base contracts and grading thresholds. Prices in SALES are list-price estimates.

export const THRESHOLDS = {
  burnCover90d: { good: 1.0, watch: 0.25 },
  paidUse30d:   { good: -0.10, watch: -0.25 },
  monthlyBurn:  { goodDays: 35, watchDays: 45, good: 0.90, watch: 0.60, raised: 1.20 },
  exits7d:      { good: 0.015, watch: 0.03, lowerIsBetter: true },
  diemLock30d:  { good: -0.02, watch: -0.05 },
  veniceVvv30d: { good: -0.01, watch: -0.03 }
};

export const CHAIN = {
  name: 'Base',
  id: 8453,
  rpcs: ['https://mainnet.base.org', 'https://base.drpc.org', 'https://base-rpc.publicnode.com'],
  maxLogRange: 50_000,
  explorer: 'https://basescan.org/address/',
  explorerTx: 'https://basescan.org/tx/'
};

export const VVV = {
  decimals: 18,
  token: '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf',
  staking: '0x321b7ff75154472B18EDb199033fF4D116F340Ff',
  stakingImpl: '0xe37A7920dbc11253ac6d031C29f592f71B348DCA',
  diem: '0xF4d97F2da56e8c3098f3a8D538DB630A2606a024',
  oracle: '0x9c4de891e14ffb39d5972814ee6cf60936c7da39',
  burnAddress: '0x0000000000000000000000000000000000000000',
  coingecko: { vvv: 'venice-token', diem: 'diem' },
  defillama: 'venice'
};

export const VENICE = {
  controlSafe: '0x2D8CB8DC596daD0e1E34E2042E7ae6Df93B11524',
  buybackSafe: '0x35fb3b67c57849bf57eb24b061eef0b5e560dc57',
  burnWallet: '0xe3157fc487c8d17bc4e7dc09c8186df657f682e7',
  burnExecutor: '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',
  signers: [
    '0x6e7fb66e68970dc0c77a29df28c9d48b260cc381',
    '0x1f72f40097165d647d95a12fdf016d1dbed04781',
    '0xc9fdc8fac8a3209932dddf39cbec1693b8f53a6d',
    '0x6847f9ce744ca17bd7f1d68250880aa269c78158',
    '0x89b0bda8cc9ff77606133e6f931f4dd73859364a',
    '0x4bcf71e7832097aa3e20470996893e653124b6e4'
  ],
  others: []
};

export const POOLS = {
  aerodromeVvvWeth: '0x01784ef301d79e4b2df3a21ad9a536d4cf09a5ce'
};

export const SALES = {
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  products: {
    '2015000':  { id: 'pro',     label: 'Pro',         price: 18,  burn: 2,  kind: 'subscription' },
    '5037500':  { id: 'proplus', label: 'Pro+',        price: 68,  burn: 5,  kind: 'subscription' },
    '10075000': { id: 'max',     label: 'Max',         price: 200, burn: 10, kind: 'subscription' },
    '5070000':  { id: 'credits', label: 'API credits', price: 100, burn: 5,  kind: 'credits' }
  }
};

export const RULES = [
  { id: 'emissionRate',    to: 'staking', sig: 'emissionRatePerSecond()',               sel: '0xa80152d6', label: 'Emission rate', format: 'perYear' },
  { id: 'venicePct',       to: 'staking', sig: 'veniceEmissionsPercentage()',           sel: '0x5dea41bb', label: 'Venice’s share of all emissions', format: 'pct1e18' },
  { id: 'venicePctLocked', to: 'staking', sig: 'veniceEmissionsPercentageWhenLocked()', sel: '0x45af37b2', label: 'Venice’s share of emissions on locked sVVV', format: 'pct1e18' },
  { id: 'cooldown',        to: 'staking', sig: 'cooldownDuration()',                    sel: '0x35269315', label: 'Unstake cooldown', format: 'seconds' },
  { id: 'treasury',        to: 'staking', sig: 'treasury()',                            sel: '0x61d027b3', label: 'Where Venice’s emissions go', format: 'address' },
  { id: 'stakingOwner',    to: 'staking', sig: 'owner()',                               sel: '0x8da5cb5b', label: 'Staking owner', format: 'address' },
  { id: 'vvvOwner',        to: 'token',   sig: 'owner()',                               sel: '0x8da5cb5b', label: 'VVV owner (the only minter)', format: 'address' },
  { id: 'diemCooldown',    to: 'diem',    sig: 'cooldownDuration()',                    sel: '0x35269315', label: 'DIEM unstake cooldown', format: 'seconds' }
];
export const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

export const DIEM = {
  target: 40_000,
  creditPerDay: 1
};

export const SALES_FROM = Date.UTC(2026, 6, 18) / 1000;
export const ZERO = '0x0000000000000000000000000000000000000000';
export const DEAD = '0x000000000000000000000000000000000000dEaD';
export const POLICY_LOG = [
  { date: '2025-10-23', kind: 'emissions', label: 'Emission rate reduced to about 8M VVV per year', tx: '0xe3a3e13a9c5e1661c40a5c9782167e9861a860a42b5d6f162b06cb20aea9f12c' },
  { date: '2026-02-11', kind: 'emissions', label: 'Emission rate reduced to 6M VVV per year', tx: '0x424dd14ac00569f5e0d768a3a45459d2248567f3b8665a337131cd2235939b6d' }
];
