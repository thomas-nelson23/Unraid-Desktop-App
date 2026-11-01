const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

// Runs one command on a server over SSH with the keys on this computer.
// BatchMode means a missing key fails straight away instead of waiting for a
// password nobody can type. Where OpenSSH supports it, the connection is kept
// open for a minute so a poll every few seconds doesn't shake hands each time.
const CONTROL = process.platform === 'win32' ? [] : ['-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(os.tmpdir(), 'cubecrusher-ssh-%C')}`, '-o', 'ControlPersist=60'];

function run(server, args, { timeout = 20_000 } = {}) {
  const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new', ...CONTROL, '-p', String(server.port || 22), `${server.user || 'root'}@${server.host}`, ...args];
  return new Promise((resolve, reject) => {
    execFile('ssh', sshArgs, { timeout, maxBuffer: 64 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const text = String(stderr || err.message).trim();
      if (err.code === 'ENOENT') return reject(new Error('The ssh command is not installed on this computer.'));
      if (/Permission denied/i.test(text)) return reject(new Error(`${server.name} refused the SSH key. Add this computer's public key to ${server.user || 'root'}@${server.host}.`));
      if (/Host key verification failed/i.test(text)) return reject(new Error(`${server.name}'s SSH host key changed. Check ~/.ssh/known_hosts.`));
      if (/Could not resolve|Connection (refused|timed out)|No route to host|Operation timed out/i.test(text)) return reject(new Error(`Can't reach ${server.name} (${server.host}) over SSH: ${text.split('\n').pop()}`));
      if (/docker: (command )?not found/i.test(text)) return reject(new Error(`Docker isn't installed on ${server.name}.`));
      if (err.killed) return reject(new Error(`${server.name} took too long to answer.`));
      reject(new Error(text.split('\n').pop() || `${server.name}: ssh failed`));
    });
  });
}

const docker = (server, args, opts) => run(server, ['docker', ...args], opts);

// Something that failed recently isn't tried again for a while, so a poll
// every few seconds doesn't hammer a server that can't answer.
function withBackoff(fn, { retryAfter = 60_000 } = {}) {
  let downUntil = 0;
  let lastError = null;
  return async (...args) => {
    if (Date.now() < downUntil) throw lastError;
    try {
      return await fn(...args);
    } catch (err) {
      downUntil = Date.now() + retryAfter;
      lastError = err;
      throw err;
    }
  };
}

module.exports = { run, docker, withBackoff };
