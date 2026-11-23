import { VENICE, VVV } from '../lib/config.js';
import { dayOffset } from '../lib/metrics.js';
import { decodeAggregate3, encodeAggregate3, MULTICALL3 } from '../lib/multicall.js';
import { addressWord } from './rpc.mjs';

const directory = 'https://venicestats.com/treasury';
const tracked = [
  {label:'Control Safe', address:VENICE.controlSafe, role:'Treasury', cohort:true},
  {label:'Incentive Fund Relay', address:'0x4665883f3adb708f301ba75764d39ad0cd2a4d84', role:'Ecosystem incentives', cohort:true},
  {label:'Liquidity Safe', address:'0xb3c89592d84ae6adb6a1aa41515ac14ec822b175', role:'Liquidity', cohort:true},
  {label:'Team Ops Safe', address:'0xb6e08047320b4b4d943d7f1363776dddc6f4aa66', role:'Team operations'},
  {label:'Staking Wallet A', address:'0xf1ef353babfffb09925ef29eccbc1948aedc7720', role:'Staking'}
];
const unit = amount => Number(amount) / 1e18;
const word = /^0x[\da-f]{64}$/i;

function safeOwners(owners, quorum) {
  if (!owners.success || !quorum.success || !word.test(quorum.data)) return null;
  const data = owners.data.slice(2);
  if (!/^[0-9a-f]+$/i.test(data) || data.length < 128 || BigInt('0x'+data.slice(0,64)) !== 32n) return null;
  const count = Number(BigInt('0x'+data.slice(64,128)));
  const threshold = Number(BigInt(quorum.data));
  if (data.length !== (count+2)*64 || threshold < 1 || threshold > count) return null;
  const list = Array.from({length:count}, (_,i) => '0x'+data.slice(128+i*64+24,192+i*64).toLowerCase());
  if (new Set(list).size !== count) return null;
  return {owners:list.sort(),threshold};
}

async function readAt(rpc, row) {
  const calls = tracked.flatMap(({address}) => {
    const holder = addressWord(address), balance = '0x70a08231'+holder;
    return [[VVV.token,balance],[VVV.staking,balance],[VVV.diem,balance],
      [VVV.staking,'0x16934fc4'+holder],[address,'0xa0e67e2b'],[address,'0xe75235b8']]
      .map(([to,data],i)=>({to,data,allowFailure:i>=4}));
  });
  const result = await rpc.call('eth_call',[{to:MULTICALL3,data:encodeAggregate3(calls)},{blockHash:row.blockHash,requireCanonical:true}]);
  if (!/^0x(?:[0-9a-f]{64})+$/i.test(result) || BigInt('0x'+result.slice(66,130))!==BigInt(calls.length)) throw Error('Invalid wallet multicall at '+row.toBlock);
  const decoded = decodeAggregate3(result);
  const observations = tracked.map((wallet,i) => {
    const [vvv,svvv,diem,stake,owners,quorum] = decoded.slice(i*6,i*6+6);
    if (![vvv,svvv,diem].every(v=>v?.success && word.test(v.data)) || !stake?.success ||
        !/^0x[\da-f]{192}$/i.test(stake.data)) throw Error('Missing wallet balance for '+wallet.label);
    const values = [BigInt(vvv.data), BigInt(svvv.data), BigInt('0x'+stake.data.slice(-64))];
    return {values, principal:values.reduce((a,b)=>a+b,0n), diem:BigInt(diem.data), safe:safeOwners(owners,quorum)};
  });
  const [control] = observations;
  if (!control.safe || control.values.some((v,i)=>v.toString()!==row.raw[['veniceVvv','veniceSvvv','veniceCooldown'][i]])) throw Error('Control Safe checkpoint mismatch');
  return observations;
}

export function sameOwners(a,b) {
  return !!a && !!b && a.owners.length===b.owners.length && a.owners.every((owner,i)=>b.owners[i]===owner);
}

export async function collectWallets(rpc, protocol) {
  const close=protocol.days.at(-1), open=protocol.days.at(-31);
  if (!open || dayOffset(open.date,30)!==close.date) throw Error('Missing 30-day wallet anchor');
  const [before,after] = await Promise.all([readAt(rpc,open),readAt(rpc,close)]);
  const isStakingOwner = row => row.parameters?.stakingOwner?.toLowerCase() === VENICE.controlSafe.toLowerCase();
  const sameControl = isStakingOwner(open) && isStakingOwner(close);
  const wallets = tracked.map(({label,address,role,cohort},i) => {
    const a=after[i], b=before[i], shared=sameOwners(a.safe,after[0].safe);
    const common=a.safe?.owners.filter(owner=>after[0].safe.owners.includes(owner)).length ?? 0;
    const attribution = i===0 ? (isStakingOwner(close) ? 'Owns the VVV staking contract' : 'Historical control Safe') : shared ? 'Same signers as the control Safe'
      : a.safe ? common+' of '+a.safe.owners.length+' signers shared with the control Safe' : 'Wallet role attributed by VeniceStats';
    return {label,address,role,sourceUrl:i===0?'https://venice.ai/faqs/all':directory,
      attribution,threshold:a.safe?.threshold ?? null,ownerCount:a.safe?.owners.length ?? null,
      inGrade:!!cohort && sameControl && shared && sameOwners(b.safe,before[0].safe),
      vvv:unit(a.values[0]),svvv:unit(a.values[1]),cooldown:unit(a.values[2]),diem:unit(a.diem),change30:unit(a.principal-b.principal)};
  });
  const ids=tracked.flatMap((row,i)=>row.cohort?[i]:[]);
  const consistent=ids.every(i=>wallets[i].inGrade);
  const total=(rows)=>unit(ids.reduce((n,i)=>n+rows[i].principal,0n));
  const recent=protocol.days.slice(-30);
  const otherAddresses = tracked.filter(w=>w.cohort && w.address!==VENICE.controlSafe).map(w=>w.address.toLowerCase());
  const complete=recent.length===30 && recent.every(row=>row.flowsVerified && Number.isFinite(row.mintVenice) && Array.isArray(row.unexpectedMints));
  const emissions = complete ? recent.reduce((n,row)=>n+row.mintVenice+
    row.unexpectedMints.filter(m=>otherAddresses.includes(m.to.toLowerCase())).reduce((s,m)=>s+m.amount,0),0):null;
  const opening=total(before), closing=total(after);
  return {asOf:close.date,block:close.toBlock,startBlock:open.toBlock,wallets,
    trackedSafeTotal:consistent ? closing:null, trackedSafeChange30:consistent && complete && opening>0 ? (closing-emissions)/opening-1:null};
}
