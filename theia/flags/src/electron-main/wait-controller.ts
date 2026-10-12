import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { createServer, Socket } from 'net';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * Keep the invoking terminal process alive while an independent Electron process
 * opens the requested editor. Each invocation owns a private Unix socket, so
 * simultaneous Git editor requests cannot complete one another.
 */
export async function runWaitController(applicationArgs: readonly string[]): Promise<number> {
	const directory = await fs.mkdtemp(path.join(tmpdir(), 'theia-wait-'));
	const socketPath = path.join(directory, 'complete.sock');
	const sockets = new Set<Socket>();
	const server = createServer();
	let settle!: (code: number, error?: string) => void;
	let startupTimeout: ReturnType<typeof setTimeout> | undefined;
	const onInterrupt = (): void => settle(130);
	const onTerminate = (): void => settle(143);

	try {
		return await new Promise<number>(resolve => {
			let finished = false;
			settle = (code, error) => {
				if (finished) {
					return;
				}
				finished = true;
				if (error) {
					process.stderr.write(`theia: ${error}\n`);
				}
				resolve(code);
			};

			process.once('SIGINT', onInterrupt);
			process.once('SIGTERM', onTerminate);
			server.on('connection', socket => {
				if (startupTimeout) {
					clearTimeout(startupTimeout);
					startupTimeout = undefined;
				}
				sockets.add(socket);
				socket.setEncoding('utf8');
				let response = '';
				socket.on('data', chunk => {
					response += chunk;
					if (response.length > 8192) {
						settle(1, 'Invalid wait response');
					}
				});
				socket.once('end', () => {
					if (response === '0') {
						settle(0);
					} else if (response.startsWith('1:')) {
						settle(1, response.slice(2));
					} else {
						settle(1, 'Editor connection closed before editing completed');
					}
				});
				socket.once('error', error => settle(1, error.message));
				socket.once('close', () => {
					sockets.delete(socket);
					if (!socket.readableEnded) {
						settle(1, 'Editor connection interrupted');
					}
				});
			});
			server.once('error', error => settle(1, error.message));
			server.listen(socketPath, () => {
				startupTimeout = setTimeout(() => settle(1, 'Theia did not accept the wait request'), 120000);
				const separator = applicationArgs.indexOf('--');
				const args = applicationArgs.filter((arg, index) => (separator !== -1 && index > separator) || (arg !== '--wait' && arg !== '-w'));
				const endOfOptions = args.indexOf('--');
				args.splice(endOfOptions === -1 ? args.length : endOfOptions, 0, `--theia-wait-socket=${socketPath}`);
				const child = spawn(process.execPath, args, {
					cwd: process.cwd(),
					detached: true,
					env: { ...process.env },
					stdio: 'ignore'
				});
				child.once('error', error => settle(1, `Could not start Theia: ${error.message}`));
				child.once('exit', (code, signal) => {
					if (code !== null && code !== 0 || signal) {
						settle(1, `Theia exited before opening the editor (${signal ?? code})`);
					}
				});
				child.unref();
			});
		});
	} finally {
		if (startupTimeout) {
			clearTimeout(startupTimeout);
		}
		process.off('SIGINT', onInterrupt);
		process.off('SIGTERM', onTerminate);
		for (const socket of sockets) {
			socket.destroy();
		}
		if (server.listening) {
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
		await fs.rm(directory, { recursive: true, force: true });
	}
}
