import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWallets} from '../scripts/wallets.mjs';
import {encodeAggregate3Results} from '../lib/multicall.js';
import {word} from '../scripts/rpc.mjs';
import {VENICE} from '../lib/config.js';

const unit=10n**18n;
const days=Array.from({length:31},(_,i)=>({
  date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),
  toBlock:100+i,blockHash:'0x'+word(100+i),flowsVerified:true,unexpectedMints:[],
  parameters:{stakingOwner:VENICE.controlSafe},
  mintVenice:i===30?5:0,raw:{veniceVvv:String((i===30?85n:100n)*unit),veniceSvvv:'0',veniceCooldown:'0'}
}));
function fakeRpc({changed=false}={}) {
  return {async call(method,[,anchor]) {
    assert.equal(method,'eth_call');
    assert.equal(anchor.requireCanonical,true);
    const closing=anchor.blockHash===days.at(-1).blockHash;
    const balances=closing?[85,100,20,7,9]:[100,80,20,7,9];
    const body=balances.flatMap((balance,i)=>{
      const member1=i===3 || (i===1 && closing && changed)?3:1;
      const owners='0x'+[32,2,member1,2].map(word).join('');
      return [
        ...[balance,0,0].map(n=>({success:true,data:'0x'+word(BigInt(n)*unit)})),
        {success:true,data:'0x'+word(0).repeat(3)},
        {success:i!==4,data:i===4?'0x':owners},
        {success:i!==4,data:i===4?'0x':'0x'+word(2)}
      ];
    });
    return encodeAggregate3Results(body);
  }};
}
test('tracked Safe balances cancel internal moves and deduct direct issuance across the same addresses',async()=>{
  const result=await collectWallets(fakeRpc(),{days});
  assert.deepEqual(result.wallets.map(r=>r.inGrade),[true,true,true,false,false]);
  assert.equal(result.trackedSafeTotal,205);
  assert.equal(result.trackedSafeChange30,0);
  assert.equal(result.wallets[1].change30,20);
});
test('changed ownership or an unverified mint day cannot produce a comparable holdings grade',async()=>{
  const changed=await collectWallets(fakeRpc({changed:true}),{days});
  assert.equal(changed.wallets[1].inGrade,false);
  assert.equal(changed.trackedSafeChange30,null);
  const partial=days.map((r,i)=>i===5?{...r,flowsVerified:false}:r);
  const pending=await collectWallets(fakeRpc(),{days:partial});
  assert.equal(pending.trackedSafeChange30,null);
  assert.equal(pending.trackedSafeTotal,205);
});
