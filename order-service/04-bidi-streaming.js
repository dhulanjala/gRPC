// ===========================================================================
//  RUN ME ALONE to see BIDIRECTIONAL STREAMING: both sides talk at once.
//    node 04-bidi-streaming.js
// ===========================================================================
const inv = require('./inventory-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('--- opening WatchStock(stream) ---');
  const call = inv.watchStock();

  const done = new Promise((resolve) => {
    call.on('data', (u) => console.log(`<- ${u.observedAt.slice(11, 19)}  ${u.productId}  stock=${u.stock}  (${u.name})`));
    call.on('end', resolve);
    call.on('error', (e) => { console.log('stream error:', e.details || e.message); resolve(); });
  });

  console.log('-> watch P1001');
  call.write({ productId: 'P1001' });
  await sleep(1200);

  console.log('-> watch P1004 (added mid-stream, while updates keep arriving)');
  call.write({ productId: 'P1004' });
  await sleep(2200);

  console.log('-> half-closing our side (call.end())');
  call.end();
  await done;
  console.log('stream closed by both sides');
}

main()
  .catch((err) => {
    if (err.code === inv.grpc.status.UNAVAILABLE) {
      console.error('\nCannot reach inventory-service. Start it first:\n  cd inventory-service && npm start\n');
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  })
  .finally(() => inv.close());
