// ===========================================================================
//  See the actual protobuf BINARY WIRE FORMAT, and compare it to JSON.
//  This bypasses grpc-js's decoding so you can look at the raw bytes that
//  travel inside HTTP/2 DATA frames between the two services.
//    node 05-serialization.js
// ===========================================================================
const path = require('path');
const protobuf = require('protobufjs');

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'inventory.proto');

async function main() {
  const root = await protobuf.load(PROTO_PATH);
  const Product = root.lookupType('inventory.Product');

  const productObj = {
    id: 'P1001',
    name: 'ThinkPad X1 Carbon',
    price: 1499.0,
    stock: 12,
    category: 1, // COMPUTING
  };

  // --- protobuf: encode the object to raw bytes -----------------------
  const message = Product.create(productObj);
  const protoBytes = Product.encode(message).finish(); // a Buffer/Uint8Array

  // --- JSON: encode the same data as text, for comparison -------------
  const jsonBytes = Buffer.from(JSON.stringify(productObj), 'utf8');

  console.log('=== the JS object we are sending ===');
  console.log(productObj);

  console.log('\n=== as JSON text (%d bytes) ===', jsonBytes.length);
  console.log(jsonBytes.toString('utf8'));

  console.log('\n=== as protobuf binary (%d bytes) ===', protoBytes.length);
  console.log('hex :', Buffer.from(protoBytes).toString('hex'));
  // printable-ish view: non-printable bytes shown as '.'
  console.log('raw :', [...protoBytes].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join(''));

  console.log(`\nprotobuf is ${jsonBytes.length - protoBytes.length} bytes smaller `
    + `(${Math.round((1 - protoBytes.length / jsonBytes.length) * 100)}% less) than JSON for this message.`);

  // --- decode it back, byte-by-byte annotated for the first few fields --
  console.log('\n=== manual byte-by-byte breakdown ===');
  annotate(protoBytes, root);

  // --- prove round-trip decoding works ---------------------------------
  const decoded = Product.decode(protoBytes);
  console.log('\n=== decoded back from bytes ===');
  console.log(Product.toObject(decoded));
}

// Very small varint/tag reader, just to show HOW the bytes map to fields.
// Real code never does this manually - protobufjs/grpc-js does it for you.
function annotate(bytes, root) {
  const Category = root.lookupEnum('inventory.Category');
  let i = 0;
  const readVarint = () => {
    let result = 0, shift = 0, b;
    do { b = bytes[i++]; result |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return result >>> 0;
  };

  const fieldNames = { 1: 'id', 2: 'name', 3: 'price', 4: 'stock', 5: 'category' };

  while (i < bytes.length) {
    const start = i;
    const tag = readVarint();
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;
    const wireTypeName = { 0: 'VARINT', 1: 'FIXED64', 2: 'LENGTH_DELIMITED', 5: 'FIXED32' }[wireType];

    let valueDesc;
    if (wireType === 2) {
      const len = readVarint();
      const raw = bytes.slice(i, i + len);
      valueDesc = `"${Buffer.from(raw).toString('utf8')}"`;
      i += len;
    } else if (wireType === 0) {
      const v = readVarint();
      valueDesc = fieldNum === 5 ? `${v} (${Category.valuesById[v]})` : String(v);
    } else if (wireType === 1) {
      valueDesc = bytes.readDoubleLE(i);
      i += 8;
    } else {
      break; // not needed for this message
    }

    const tagBytes = Buffer.from(bytes.slice(start, start + 1)).toString('hex');
    console.log(
      `  field ${fieldNum} (${(fieldNames[fieldNum] || '?').padEnd(8)}) `
      + `tag=0x${tagBytes} wireType=${wireTypeName.padEnd(16)} value=${valueDesc}`
    );
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
