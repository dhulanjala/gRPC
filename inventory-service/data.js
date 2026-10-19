// A fake in-memory database. In a real service this is Postgres/Mongo/etc.
const products = new Map([
  ['P1001', { id: 'P1001', name: 'ThinkPad X1 Carbon', price: 1499.0, stock: 12, category: 'COMPUTING' }],
  ['P1002', { id: 'P1002', name: 'MX Master 3S Mouse', price: 99.99, stock: 140, category: 'ACCESSORY' }],
  ['P1003', { id: 'P1003', name: 'Mechanical Keyboard', price: 149.5, stock: 38, category: 'ACCESSORY' }],
  ['P1004', { id: 'P1004', name: '27" 4K Monitor',     price: 429.0, stock: 7,  category: 'COMPUTING' }],
  ['P1005', { id: 'P1005', name: 'Noise-Cancel Headset', price: 279.0, stock: 0, category: 'AUDIO' }],
]);

module.exports = { products };
