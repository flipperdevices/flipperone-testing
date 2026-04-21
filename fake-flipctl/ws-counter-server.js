#!/usr/bin/env node
'use strict';

// Zero-dependency WebSocket server. Implements RFC 6455 handshake and text
// frame sending inline so we don't pull in the `ws` package. Broadcasts
// { counter, ts } to all connected clients once per second. Used by
// test-screen.html "Websocket redraw" benchmark.

var http = require('http');
var crypto = require('crypto');

var PORT = 8898;
var BIND = '127.0.0.1';
var MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function buildTextFrame(text) {
    var payload = Buffer.from(text, 'utf8');
    var len = payload.length;
    var head;
    if (len < 126) {
        // 0x81 = FIN bit + text opcode 0x1
        head = Buffer.from([0x81, len]);
    } else if (len < 65536) {
        head = Buffer.alloc(4);
        head[0] = 0x81; head[1] = 126;
        head.writeUInt16BE(len, 2);
    } else {
        head = Buffer.alloc(10);
        head[0] = 0x81; head[1] = 127;
        head.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([head, payload]);
}

var clients = new Set();
var counter = 0;

var server = http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ws-counter: upgrade to ws://' + BIND + ':' + PORT + '/\n');
});

server.on('upgrade', function (req, socket) {
    var key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    var accept = crypto.createHash('sha1').update(key + MAGIC).digest('base64');
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    clients.add(socket);
    socket.on('close', function () { clients.delete(socket); });
    socket.on('error', function () { clients.delete(socket); });
    console.log('client connected (' + clients.size + ' total)');
});

setInterval(function () {
    counter++;
    var frame = buildTextFrame(JSON.stringify({ counter: counter, ts: Date.now() }));
    clients.forEach(function (sock) {
        try { sock.write(frame); }
        catch (e) { clients.delete(sock); }
    });
}, 1000);

server.listen(PORT, BIND, function () {
    console.log('ws-counter listening on http://' + BIND + ':' + PORT + '/ (upgrade to ws://)');
});
