# VVV Watch

A daily, independently reproducible ledger of Venice’s VVV issuance, buybacks and DIEM collateral on Base. The dashboard follows the same completed-day approach as [Overwatch](https://github.com/provatidis/overwatch).

**[Open VVV Watch](https://provatidis.com/vvvwatch/)** · [Latest dashboard data](data/latest.json) · [Protocol history](data/protocol.json) · [Burn and purchase evidence](data/burns.json)

## Read the ledger

- **Burn cover** divides the increase in the VVV zero- and dead-address balances by newly minted VVV over the same dates. The headline uses 90 completed UTC days. The 30-day reading shows recent direction. A ratio of 1 means supply was flat over that window. Effective supply equals contract total supply minus the two sink balances.
- **Buybacks** follow the buyback Safe from one burn to the next. The collector checks each burn receipt on Base and reconciles indexed transfers against the Safe’s closing VVV and USDC balances. A USDC debit and VVV receipt in the same transaction establish purchase cost. Unmatched USDC debits leave the spending grade pending for that cycle. Historical receipts begin in June 2026. October and November have fully attributed spending.
- **Signup and credit purchases** use observed burn-wallet USDC amounts matched to VVV retirement in the same transaction. Both the burn-address VVV change and the wallet’s USDC change must reconcile. The purchase estimate applies published list prices to recognized events. Billing term, discounts and renewals limit the inference. The launch snapshot has independent transaction evidence from September 22, 2026 and a separately labeled VeniceStats reference from July 18.
- **DIEM** can be minted by locking staked VVV. The page reports collateral, mint terms and deposited DIEM. Deposits include withdrawals in cooldown. Market price and the maximum annual face value of credits assume distinct units. Each staked DIEM grants up to $1 per day in Venice credits. The seven-day usage ratio uses VeniceStats’ reported daily consumption and capacity for closed days. It is supplementary to the on-chain checks.
- **Treasury and control** refer to the named control Safe. Its tracked holdings include liquid VVV, sVVV and the underlying VVV awaiting withdrawal. An external transfer alone cannot establish a sale. Rule events and block links provide evidence for changes in protocol settings.

The thresholds in [lib/config.js](lib/config.js) are editorial choices. Burn cover below 25% is graded Alert, 25% through just below 100% is Watch, and 100% or above is Healthy. An Alert describes the observed window. When an input is missing, a grade is pending or stale.

## Data and publication

The [daily workflow](.github/workflows/watch.yml) runs at 03:41 UTC, tests the code, updates the source datasets and commits the dashboard snapshot and alert state. Missing archive state or an unavailable provider leaves the last verified record in place. The workflow packages a static GitHub Pages site and delivers issue notifications from the persisted state.

Freshly seeded history establishes the initial check grades. A later worsening opens an issue. A recovery closes it. The workflow also records new monthly burns, protocol-rule changes, unexpected mints, large control-Safe outflows and low burn-wallet funding. Repeated delivery uses stable identifiers.

The page and collectors require Node.js 22 or later and have no npm dependencies.

```sh
node --test
node scripts/snapshot.mjs       # fetch new completed days and compose the page data
node scripts/verify.mjs         # independently check the 30- and 90-day ledgers against Base
node scripts/build.mjs          # package the static site into dist/
python3 -m http.server 8765 --directory dist
```

Run `node scripts/snapshot.mjs --compose-only` to use the existing on-chain datasets and refresh optional market and usage context. The two collectors can be run independently. `BASE_RPC_URL` can supply an additional Base archive endpoint. GitHub issue delivery runs separately after the evidence commit.

### Sources

- [VVV token](https://basescan.org/token/0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf), [staking proxy](https://basescan.org/address/0x321b7ff75154472B18EDb199033fF4D116F340Ff), [DIEM token](https://basescan.org/address/0xF4d97F2da56e8c3098f3a8D538DB630A2606a024), and [buyback Safe](https://basescan.org/address/0x35fb3b67c57849bf57eb24b061eef0b5e560dc57).
- [Safe Transaction Service transfers](https://api.safe.global/tx-service/base/api/v1/safes/0x35Fb3b67C57849Bf57EB24b061EEF0B5E560dc57/transfers/) and [VeniceStats historical burn transaction index](https://venicestats.com/api/discretionary-burn).
- [Venice token documentation](https://docs.venice.ai/overview/vvv-diem), [credit-burn policy](https://venice.ai/blog/tokenomics-update-credit-burns-and-diem-supply-expansion), [published plan prices](https://venice.ai/pricing), and [historical burn-wallet transaction research](https://chainward.ai/decodes/venice-on-chain).
- [VeniceStats usage series](https://venicestats.com/api/diem-usage) and [CoinGecko market quotes](https://docs.coingecko.com/reference/simple-price). Each displayed price carries its own observation time.

An independent project by Apostolos Provatidis. Code is [MIT licensed](LICENSE). Font licenses are included in [assets/fonts](assets/fonts/).
