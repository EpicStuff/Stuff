'use strict';

const net = require('node:net');

const socketArg = process.argv.find(arg => arg.startsWith('--theia-wait-socket='));
if (!socketArg) {
	process.exit(2);
}

const socketPath = socketArg.slice('--theia-wait-socket='.length);
const socket = net.connect(socketPath);
socket.once('connect', () => socket.end(process.argv[2] || '0'));
socket.once('error', () => process.exit(3));
