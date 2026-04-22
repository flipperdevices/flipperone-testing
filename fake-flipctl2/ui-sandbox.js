#!/usr/bin/env node
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = 8900;
var BIND = '0.0.0.0';
var BASE = __dirname;

var MIME = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.json': 'application/json',
    '.wav':  'audio/wav'
};

function send(res, status, body, type) {
    res.writeHead(status, {
        'Content-Type': type || 'text/plain',
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function serveFile(res, filePath) {
    fs.readFile(filePath, function(err, data) {
        if (err) {
            send(res, 404, 'Not found');
            return;
        }
        var ext = path.extname(filePath).toLowerCase();
        send(res, 200, data, MIME[ext] || 'application/octet-stream');
    });
}

var server = http.createServer(function(req, res) {
    var urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/ui-sandbox.html';

    var resolved = path.normalize(path.join(BASE, urlPath));
    if (resolved.indexOf(BASE) !== 0) {
        send(res, 403, 'Forbidden');
        return;
    }

    serveFile(res, resolved);
});

server.listen(PORT, BIND, function() {
    console.log('ui-sandbox listening on http://' + BIND + ':' + PORT + '/');
});
