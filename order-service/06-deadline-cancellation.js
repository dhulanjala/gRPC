// ===========================================================================
//  RUN ME ALONE to see DEADLINES and CANCELLATION actually trigger.
//    node 06-deadline-cancellation.js
//  Watch the inventory-service terminal at the same time - it logs when it
//  notices the client gave up.
// ===========================================================================
const inv = require('./inventory-client');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function demoDeadline() {
  console.log('--- A. DEADLINE ---');
  console.log('Server streams ListProducts at ~300ms/row (see server.js).');
  console.log('We call it with a 500ms deadline, which is too short to finish.\n');

  const stream = inv.listProducts({ minStock: 1, timeoutMs: 500 });

  try {
    for await (const p of stream) {
      console.log(`  received: ${p.id} ${p.name}`);
    }
    console.log('  stream finished inside the deadline (try a shorter timeoutMs if you see this)');
  } catch (err) {
    console.log(`\n  call failed: code=${err.code} (${inv.grpc.status[err.code]})`);
    console.log(`  details: ${err.details}`);
    console.log('  -> the client library cut the call off itself once the clock ran');
    console.log('     out - it did not wait for the server to answer.');
  }
}

async function demoCancellation() {
  console.log('\n--- B. CLIENT-INITIATED CANCELLATION ---');
  console.log('Opening WatchStock (bidi stream), watching P1001, then calling');
  console.log('call.cancel() ourselves after ~1.5s of updates.\n');

  const call = inv.watchStock();
  let updateCount = 0;

  const closed = new Promise((resolve) => {
    call.on('data', (u) => {
      updateCount += 1;
      console.log(`  <- update #${updateCount}: ${u.productId} stock=${u.stock}`);
    });
    call.on('error', (err) => {
      console.log(`\n  client saw stream error: code=${err.code} (${inv.grpc.status[err.code]})`);
      console.log('  -> CANCELLED is expected here: WE ended the call ourselves.');
      resolve();
    });
    call.on('end', resolve);
  });

  call.write({ productId: 'P1001' });
  await sleep(1500);

  console.log('\n  -> calling call.cancel() now');
  call.cancel();

  await closed;
  console.log('\n  check the inventory-service terminal: it should log');
  console.log('  "WatchStock: cancelled" - the SERVER found out too, and');
  console.log('  stopped its setInterval so it is not doing wasted work.');
}

(async () => {
  try {
    await demoDeadline();
    await demoCancellation();
  } catch (err) {
    if (err.code === inv.grpc.status.UNAVAILABLE) {
      console.error('\nCannot reach inventory-service. Start it first:\n  cd inventory-service && npm start\n');
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  } finally {
    inv.close();
  }
})();
