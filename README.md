# VVV watch

A daily, independently reproducible ledger of Venice’s VVV issuance, buybacks and DIEM collateral on Base. The dashboard follows the same completed-day approach as [OVER watch](https://github.com/provatidis/overwatch).

**[Open VVV watch](https://vvv.watch/)** · [Latest dashboard data](data/latest.json) · [Protocol history](data/protocol.json) · [Burn and purchase evidence](data/burns.json)

## Read the ledger

- **Burn cover** divides the increase in the VVV zero- and dead-address balances by newly minted VVV over the same dates. The headline uses 90 completed UTC days. The 30-day reading is compared with the preceding, non-overlapping 30 days. A rolling window can improve as earlier high-issuance days leave it. At 100% cover, burns offset all issuance over that window. Effective supply equals contract total supply minus the two sink balances.
- **Buybacks** follow the buyback Safe from one burn to the next. The collector checks each burn receipt on Base and reconciles indexed transfers against the Safe’s closing VVV and USDC balances. The monthly check grades the time since the last burn and the change in estimated USD value retired. It values the burn at the end of its Base block using the Aerodrome WETH/VVV reserve ratio and the Chainlink ETH/USD feed. Each observation must be within 20 minutes of the burn. Missing prices leave the value comparison pending. A confirmed delay can still trigger a timing alert. The cycle ledger also reports matched USDC spending, token quantities and carried inventory.
- **Signup and credit purchases** use observed burn-wallet USDC amounts matched to VVV retirement in the same transaction. Both the burn-address VVV change and the wallet’s USDC change must reconcile. The purchase estimate applies published list prices to recognized events. The annualized figure multiplies the latest 30-day estimate by 365/30. The company revenue claim carries its own date and source. Billing term, discounts and renewals limit the comparison. The per-sale share divides the nominal USDC burn budget by estimated purchases. The combined share adds the estimated market value of every monthly burn in the same window once the receipt amounts reconcile to the classified burn logs. The launch snapshot has independent transaction evidence from September 22, 2026 and a separately labeled VeniceStats reference from July 18. The reference refreshes separately, and the comparison uses 30 complete UTC days ending on a common date.
- **DIEM** can be minted by locking staked VVV. The page reports collateral, mint terms and deposited DIEM. Deposits include withdrawals in cooldown. Market price and the maximum annual face value of credits assume distinct units. Each staked DIEM grants up to $1 per day in Venice credits. The seven-day usage ratio uses VeniceStats’ reported daily consumption and capacity for closed days. It is supplementary to the on-chain checks.
- **Treasury and control** covers the control Safe, Incentive Fund Relay and Liquidity Safe. Their owner sets must match at both ends of the 30-day comparison. The holdings check adds liquid VVV, sVVV and pending withdrawals, then subtracts verified direct emissions. Moves inside the group cancel. The page also shows Team Ops and Staking Wallet A with their evidence and attribution. An external transfer alone cannot establish a sale. Rule events and block links provide evidence for changes in protocol settings.

The thresholds in [lib/config.js](lib/config.js) are editorial choices. Burn cover below 25% is graded Alert, 25% through just below 100% is Watch, and 100% or above is Healthy. An Alert describes the observed window. When an input is missing, a grade is pending or stale.

The holder valuation compares the token value on Venice’s reported circulating supply and on effective supply with estimated purchases at the latest 30-day pace. Each uses the same VVV spot quote. Venice’s API returns a count, so the snapshot records when it was read. The separate figure excluding Venice’s tracked Safes uses their verified balances at the supply close. [Venice circulating supply](https://api.venice.ai/api/v1/vvv/circulatingsupply)

### Vesting and unlocks

VeniceStats reports the current release rate, cumulative withdrawals and projected changes to the schedule. The panel dates that observation. Its 30-day run rate assumes the reported daily rate continues. The share of gross inflow compares that rate with scheduled annual issuance divided by 365. The projected change in their combined flow holds issuance steady. [Vesting feed](https://venicestats.com/api/vesting)

For the historical rows, the collector reads every page of the VeniceStats stream directory and archives the contract addresses and stream IDs. At the same Base block hashes as the supply ledger, it checks each stream’s underlying token and reads Sablier’s `streamedAmountOf` and `getWithdrawnAmount`. Differences over the window measure newly vested and withdrawn VVV among the indexed streams. Withdrawals can include amounts vested before the window. The comparison divides burns by minting plus newly vested VVV. It measures two ways tokens become available, while the headline measures burns against issuance. [Stream directory](https://venicestats.com/api/vesting?mode=streams) · [Sablier vesting](https://docs.sablier.com/apps/features/vesting)

## Data and publication

The [daily workflow](.github/workflows/watch.yml) runs at 03:41 UTC, tests the code, updates the source datasets and commits the dashboard snapshot and alert state. Missing archive state or an unavailable provider leaves the last verified record in place. The workflow packages a static GitHub Pages site and delivers issue notifications from the persisted state. Alert evidence is calculated from the archived datasets during the refresh and is omitted from the compact public snapshot.

Freshly seeded history establishes the initial check grades. A later worsening opens an issue. A recovery closes it. The workflow also records new monthly burns, protocol-rule changes, unexpected mints, large control-Safe outflows and low burn-wallet funding. Repeated delivery uses stable identifiers.

The page and collectors require Node.js 22 or later and have no npm dependencies.

```sh
node --test
node scripts/snapshot.mjs       # fetch new completed days and compose the page data
node scripts/verify.mjs         # independently check the 30- and 90-day ledgers against Base
node scripts/verify.mjs --vesting # replay the archived stream IDs at the same blocks
node scripts/verify.mjs --rules # also verify historical emission receipts and adjacent rates
node scripts/build.mjs          # package the static site into dist/
python3 -m http.server 8765 --directory dist
```

Run `node scripts/snapshot.mjs --compose-only` to reuse the archived protocol and purchase history while reading wallet balances, signer sets, market quotes and usage context. The two history collectors can be run independently. `BASE_RPC_URL` can supply an additional Base archive endpoint. For a full staking-proxy emission-event scan from deployment, run `node scripts/verify.mjs --scan-rules` with a provider that serves historical logs. GitHub issue delivery runs separately after the evidence commit.

### Sources

- [Aerodrome pool pricing contract](https://github.com/aerodrome-finance/contracts/blob/main/contracts/Pool.sol), [Base ETH/USD feed](https://data.chain.link/feeds/base/base/eth-usd), [VeniceStats treasury directory](https://venicestats.com/treasury), and [Voorhees’ October 14 revenue statement](https://x.com/ErikVoorhees/status/2110436081581879460).

- [VVV token](https://basescan.org/token/0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf), [staking proxy](https://basescan.org/address/0x321b7ff75154472B18EDb199033fF4D116F340Ff), [DIEM token](https://basescan.org/address/0xF4d97F2da56e8c3098f3a8D538DB630A2606a024), and [buyback Safe](https://basescan.org/address/0x35fb3b67c57849bf57eb24b061eef0b5e560dc57).
- [Safe Transaction Service transfers](https://api.safe.global/tx-service/base/api/v1/safes/0x35Fb3b67C57849Bf57EB24b061EEF0B5E560dc57/transfers/) and [VeniceStats historical burn transaction index](https://venicestats.com/api/discretionary-burn).
- [Venice token documentation](https://docs.venice.ai/overview/vvv-diem), [credit-burn policy](https://venice.ai/blog/tokenomics-update-credit-burns-and-diem-supply-expansion), [published plan prices](https://venice.ai/pricing), and [historical burn-wallet transaction research](https://chainward.ai/decodes/venice-on-chain).
- [VeniceStats usage series](https://venicestats.com/api/diem-usage) and [CoinGecko market quotes](https://docs.coingecko.com/reference/simple-price). Each displayed price carries its own observation time.

An independent project by Apostolos Provatidis. Code is [MIT licensed](LICENSE). Font licenses are included in [assets/fonts](assets/fonts/).
