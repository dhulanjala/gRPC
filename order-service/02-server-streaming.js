// ===========================================================================
//  RUN ME ALONE to see SERVER STREAMING: one request -> many responses.
//    node 02-server-streaming.js
// ===========================================================================
const inv = require('./inventory-client');

async function main() {
  console.log('--- calling ListProducts({ minStock: 1 }) ---');
  console.log('(one row arrives every 300ms - watch them trickle in)\n');

  const stream = inv.listProducts({ category: 'CATEGORY_UNSPECIFIED', minStock: 1 });
  let n = 0;
  for await (const p of stream) {
    console.log(`[${++n}] ${p.id}  ${p.name.padEnd(24)} $${String(p.price).padStart(8)}  stock=${p.stock}`);
  }
  console.log(`\nstream ended after ${n} message(s)`);
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
