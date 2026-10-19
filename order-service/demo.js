// ===========================================================================
//  A pure gRPC client walkthrough - no HTTP anywhere.
//  Run `npm start` in inventory-service first, then `npm run demo` here.
// ===========================================================================
const inv = require('./inventory-client');

const line = (t) => console.log(`\n${'='.repeat(64)}\n  ${t}\n${'='.repeat(64)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function demoUnary() {
  line('1. UNARY  -  one request, one response');

  const product = await inv.getProduct('P1001');
  console.log('got:', product);

  console.log('\nnow ask for an id that does not exist:');
  try {
    await inv.getProduct('DOES-NOT-EXIST');
  } catch (err) {
    // A gRPC error carries a numeric status code - not an HTTP code, not a
    // stack trace. This is the whole point of the status model.
    console.log('  code   :', err.code, `(${inv.grpc.status[err.code]})`);
    console.log('  details:', err.details);
  }
}

async function demoServerStreaming() {
  line('2. SERVER STREAMING  -  one request, many responses');
  console.log('(one row every 300ms - notice they trickle in)\n');

  const stream = inv.listProducts({ category: 'CATEGORY_UNSPECIFIED', minStock: 1 });
  let n = 0;
  for await (const p of stream) {
    console.log(`  [${++n}] ${p.id}  ${p.name.padEnd(24)} $${String(p.price).padStart(8)}  stock=${p.stock}`);
  }
  console.log(`\nstream ended after ${n} message(s)`);
}

async function demoClientStreaming() {
  line('3. CLIENT STREAMING  -  many requests, one response');

  const cart = [
    { productId: 'P1002', quantity: 3 },
    { productId: 'P1003', quantity: 1 },
    { productId: 'P1005', quantity: 2 },   // out of stock -> lands in `failed`
    { productId: 'P1001', quantity: 1 },
  ];
  cart.forEach((i) => console.log(`  sending ${i.productId} x${i.quantity}`));

  const summary = await inv.recordSales(cart);
  console.log('\nserver replied once, after we half-closed:');
  console.log(summary);
}

async function demoBidi() {
  line('4. BIDIRECTIONAL STREAMING  -  both sides talk at once');

  const call = inv.watchStock();
  const done = new Promise((resolve) => {
    call.on('data', (u) => console.log(`  <- ${u.observedAt.slice(11, 19)}  ${u.productId}  stock=${u.stock}  (${u.name})`));
    call.on('end', resolve);
    call.on('error', (e) => { console.log('  stream error:', e.details || e.message); resolve(); });
  });

  console.log('  -> watch P1001');
  call.write({ productId: 'P1001' });
  await sleep(1200);

  // Adding a subscription mid-stream, while updates keep arriving. THIS is
  // what bidi gives you that request/response cannot.
  console.log('  -> watch P1004 (added mid-stream)');
  call.write({ productId: 'P1004' });
  await sleep(2200);

  console.log('  -> half-closing our side');
  call.end();
  await done;
  console.log('stream closed by both sides');
}

(async () => {
  try {
    await demoUnary();
    await demoServerStreaming();
    await demoClientStreaming();
    await demoBidi();
    line('done');
  } catch (err) {
    if (err.code === inv.grpc.status.UNAVAILABLE) {
      console.error('\nCannot reach inventory-service. Start it first:\n  cd inventory-service && npm start\n');
    } else {
      console.error('\nunexpected:', err);
    }
    process.exitCode = 1;
  } finally {
    inv.close();
  }
})();
