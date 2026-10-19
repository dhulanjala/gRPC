# Learn gRPC — two Node.js services talking to each other

Two real services plus a walkthrough client. Everything here has been run and verified.

```
  curl / browser
        |  HTTP + JSON
        v
  order-service  :3000        <-- gRPC CLIENT (and an HTTP gateway)
        |  gRPC over HTTP/2 + protobuf
        v
  inventory-service :50051    <-- gRPC SERVER (owns the product data)
```

`proto/inventory.proto` is the **contract**. Both sides load that exact file.

## Layout

| Path | What it is |
|---|---|
| `proto/inventory.proto` | The service + message definitions. Start reading here. |
| `inventory-service/server.js` | gRPC server implementing all four RPC types |
| `inventory-service/data.js` | Fake in-memory database |
| `order-service/inventory-client.js` | The gRPC client stub, promisified |
| `order-service/index.js` | HTTP API that calls inventory over gRPC |
| `order-service/demo.js` | Pure-gRPC walkthrough of all four RPC types |

## Run it

Dependencies are already installed. Open **two terminals**.

Terminal 1 — the server:
```powershell
cd C:\development\gRPC\inventory-service
npm start
```

Terminal 2 — the demo (this is the one to watch first):
```powershell
cd C:\development\gRPC\order-service
npm run demo
```

Then, still in terminal 2, try the HTTP gateway:
```powershell
npm start
```
```powershell
curl http://localhost:3000/products/P1002
curl "http://localhost:3000/products?minStock=10"
curl -X POST http://localhost:3000/orders -H "content-type: application/json" -d "{\"items\":[{\"productId\":\"P1002\",\"quantity\":2}]}"
curl http://localhost:3000/products/NOPE          # gRPC NOT_FOUND -> HTTP 404
```

Open `http://localhost:3000/watch?ids=P1001,P1004` in a browser to see the
bidirectional stream pushing live updates.

## The four RPC types

This is the core thing to learn. The RPC type is declared by where you put
`stream` in the `.proto`, and it changes the handler signature on both sides.

### 1. Unary — `rpc GetProduct (Req) returns (Res)`
One request, one response. A normal function call across the network.

```js
// server                              // client
(call, callback) => {                  client.getProduct({id}, (err, res) => {})
  callback(null, product)
}
```

### 2. Server streaming — `returns (stream Res)`
One request, many responses. Use for: large result sets, feeds, progress.

```js
// server                              // client
(call) => {                            const s = client.listProducts(req)
  call.write(msg); call.end()          for await (const m of s) { ... }
}
```

### 3. Client streaming — `rpc X (stream Req) returns (Res)`
Many requests, one response. Use for: uploads, batch ingest, metrics.
The client calls `.end()` — a **half-close**, meaning "done sending, still listening".

```js
// server                              // client
(call, callback) => {                  const c = client.recordSales(cb)
  call.on('data', m => ...)            c.write(item); c.end()
  call.on('end', () => callback(null, summary))
}
```

### 4. Bidirectional — `rpc X (stream Req) returns (stream Res)`
Both sides send independently over one connection. Use for: chat, live
subscriptions, anything where either side may speak first.
`demo.js` adds a second subscription *while* updates are already arriving —
that's the capability request/response cannot give you.

## Things worth internalising

**Field numbers are the wire format.** In `Product`, `stock = 4` means the tag
`4` is what gets encoded, not the string `"stock"`. You can rename a field
freely; you can never reuse or renumber a tag once it ships.

**Errors are status codes, not exceptions.** Never `throw` in a handler — pass
`{ code: grpc.status.NOT_FOUND, details: '...' }` to the callback. The client
gets `err.code === 5`. `order-service/index.js` maps those to HTTP codes, which
is exactly what any gRPC-fronting gateway has to do.

**Create the client once.** `new inventory.Inventory(...)` opens an HTTP/2
connection pool. Building one per request is the most common gRPC performance
mistake — it throws away the multiplexing that makes gRPC fast.

**Deadlines are absolute timestamps**, not durations: `new Date(Date.now() + ms)`.
Always set one. They propagate, so a deadline at the edge bounds the whole call chain.

**Cancellation propagates.** Close the browser tab on `/watch` and the server's
`call.on('cancelled')` fires and stops the work. Verified — check the server log.

**`keepCase: false`** makes proto-loader convert `product_id` to `productId`.
Both sides must use the *same* loader options or field names won't line up.

**Insecure credentials are plaintext.** Fine on localhost. Production uses
`grpc.ServerCredentials.createSsl(...)` / `grpc.credentials.createSsl(...)`.

## Where to go next

- Add a new RPC to the `.proto`, then implement it on both sides — the loop is the lesson.
- Add `@grpc/reflection` to the server so you can poke it with `grpcurl` without the proto file.
- Try static codegen with `grpc-tools` to get generated classes instead of runtime loading.
- Add an interceptor for logging/auth (`interceptors` option on the client).
