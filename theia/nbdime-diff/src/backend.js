'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn, execFile} = require('node:child_process');

function commandAvailable(program) {
	return new Promise((resolve, reject) => {
		execFile(program, ['--version'], {timeout: 5000}, (error, stdout, stderr) => {
			const output = `${stdout || ''}\n${stderr || ''}`.trim();
			// nbdime 4.0.4 uses sys.exit(version), which prints the version to stderr
			// and exits with code 1 despite being installed and working correctly.
			if (/^\d+\.\d+\.\d+(?:[a-zA-Z0-9.+-]*)?$/.test(output) && (!error || error.code === 1)) {
				resolve(output);
			} else {
				reject(new Error(`Cannot run ${program} --version: ${(output || error?.message || 'Unexpected version output').trim()}`));
			}
		});
	});
}

function availablePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = server.address().port;
			server.close(error => error ? reject(error) : resolve(port));
		});
	});
}

function isRunning(url) {
	return new Promise(resolve => {
		const request = http.get(url, response => {
			response.resume();
			resolve(response.statusCode === 200);
		});
		request.setTimeout(1000, () => request.destroy());
		request.once('error', () => resolve(false));
	});
}

function waitForStart(child, url) {
	return new Promise((resolve, reject) => {
		let done = false;
		let output = '';
		const started = Date.now();
		const log = data => output = (output + data.toString()).slice(-5000);
		child.stdout.on('data', log);
		child.stderr.on('data', log);
		function finish(error) {
			if (done) return;
			done = true;
			child.removeListener('exit', exited);
			child.removeListener('error', failed);
			if (error) reject(error);
			else resolve();
		}
		function exited(code) {
			finish(new Error(`nbdime exited with status ${code}. ${output}`));
		}
		function failed(error) {
			finish(error);
		}
		child.once('exit', exited);
		child.once('error', failed);
		async function poll() {
			while (!done && Date.now() - started < 20000) {
				if (await isRunning(url)) {
					finish();
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 150));
			}
			if (!done) finish(new Error(`nbdime startup timed out. ${output}`));
		}
		void poll();
	});
}

const readyScript = `<script>
(function () {
	function signal() {
		if (!document.querySelector('.jp-Notebook-diff')) return;
		window.parent.postMessage({type: 'theia-nbdime-ready'}, '*');
		observer.disconnect();
	}
	const observer = new MutationObserver(signal);
	observer.observe(document.documentElement, {childList: true, subtree: true});
	signal();
})();
</script>`;

function renderDiffPage(html) {
	if (!html.includes('</body>')) throw new Error('nbdime returned a page without a body closing tag');
	return html.replace('</body>', readyScript + '</body>');
}

function startProxy(backendPort, token) {
	return new Promise((resolve, reject) => {
		const prefix = `/${token}/`;
		const proxy = http.createServer((request, response) => {
			const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
			const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
			const allowedPath = relative === 'diff' || relative === 'api/diff' || relative.startsWith('static/');
			if (!allowedPath || !['GET', 'POST'].includes(request.method)) {
				response.writeHead(404);
				response.end('Not found');
				return;
			}
			const headers = {...request.headers, host: `127.0.0.1:${backendPort}`};
			delete headers['accept-encoding'];
			delete headers['content-length'];
			delete headers.origin;
			delete headers.referer;
			const upstream = http.request({hostname: '127.0.0.1', port: backendPort, path: request.url, method: request.method, headers}, upstreamResponse => {
				const resultHeaders = {...upstreamResponse.headers};
				delete resultHeaders['content-security-policy'];
				delete resultHeaders['x-frame-options'];
				if (relative === 'diff' && request.method === 'GET' && upstreamResponse.statusCode === 200 && String(resultHeaders['content-type'] || '').includes('text/html')) {
					const chunks = [];
				upstreamResponse.on('data', data => chunks.push(data));
				upstreamResponse.on('end', () => {
					try {
						const html = renderDiffPage(Buffer.concat(chunks).toString('utf8'));
						const output = Buffer.from(html, 'utf8');
						delete resultHeaders['content-encoding'];
						delete resultHeaders.etag;
						resultHeaders['content-length'] = String(output.length);
						response.writeHead(upstreamResponse.statusCode, resultHeaders);
						response.end(output);
					} catch (error) {
						response.writeHead(502);
						response.end(`Could not embed nbdime: ${error.message}`);
					}
					});
				} else {
					response.writeHead(upstreamResponse.statusCode || 502, resultHeaders);
					upstreamResponse.pipe(response);
				}
			});
			upstream.on('error', error => {
				if (!response.headersSent) response.writeHead(502);
				response.end(`nbdime proxy error: ${error.message}`);
			});
			request.pipe(upstream);
		});
		proxy.once('error', reject);
		proxy.listen(0, '127.0.0.1', () => resolve({proxy, port: proxy.address().port}));
	});
}

async function startBackend(before, after, hideUnchanged = true, command = 'nbdime') {
	await commandAvailable(command);
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'theia-nbdime-'));
	let child;
	let proxy;
	try {
		await Promise.all([
			fs.writeFile(path.join(directory, 'before.ipynb'), before, {mode: 0o600}),
			fs.writeFile(path.join(directory, 'after.ipynb'), after, {mode: 0o600})
		]);
		const port = await availablePort();
		const token = crypto.randomBytes(24).toString('hex');
		const args = ['diff-web', '--browser=disabled', '--ip=127.0.0.1', `--port=${port}`, `--base-url=/${token}/`, `--workdirectory=${directory}`];
		if (!hideUnchanged) args.push('--show-unchanged');
		args.push('before.ipynb', 'after.ipynb');
		child = spawn(command, args, {cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
		await waitForStart(child, `http://127.0.0.1:${port}/${token}/diff?base=before.ipynb&remote=after.ipynb`);
		const result = await startProxy(port, token);
		proxy = result.proxy;
		const url = `http://127.0.0.1:${result.port}/${token}/diff?base=before.ipynb&remote=after.ipynb`;
		return {uri: url, child, proxy, directory};
	} catch (error) {
		if (proxy) proxy.close();
		if (child && !child.killed) child.kill();
		await fs.rm(directory, {recursive: true, force: true}).catch(() => {});
		throw error;
	}
}

function cleanupBackend(backend) {
	if (backend.proxy) backend.proxy.close();
	if (backend.child && !backend.child.killed) backend.child.kill();
	fs.rm(backend.directory, {recursive: true, force: true}).catch(error => console.error('Notebook Diff cleanup:', error));
}

module.exports = {startBackend, cleanupBackend, commandAvailable, renderDiffPage};
