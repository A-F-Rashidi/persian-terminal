// A small API-boundary mock. This is not a substitute for a real VS Code smoke test.
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
function createHost() {
  const disposable = { dispose() {} };
  let provider, receiver, disposedHandler, visibilityHandler;
  const sent = [], commands = new Map();
  const settings = { sessionBackend: 'legacy', shell: 'sh', shellPath: '', fontFamily: 'DejaVu Sans, monospace', fontSize: 14, maxLines: 2000 };
  const uri = p => ({ fsPath: p, toString: () => pathToFileURL(p).href });
  const mock = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    workspace: {
      isTrusted: true, workspaceFolders: [{ uri: uri(root) }],
      getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback, update: async (key, value) => { settings[key] = value; } }),
      onDidChangeConfiguration: () => disposable
    },
    window: {
      registerWebviewViewProvider: (_id, p) => { provider = p; return disposable; },
      showOpenDialog: async () => undefined, showQuickPick: async () => undefined
    },
    commands: { registerCommand: (id, callback) => { commands.set(id, callback); return disposable; }, executeCommand: async () => {} },
    env: { clipboard: { writeText: async text => { mock.clipboard = text; } } },
    ConfigurationTarget: { Global: 1 }
  };
  const original = Module._load;
  Module._load = function (request, ...args) { return request === 'vscode' ? mock : original.call(this, request, ...args); };
  try {
    delete require.cache[require.resolve('../out/extension.js')];
    const context = { extensionUri: uri(root), subscriptions: [] };
    require('../out/extension.js').activate(context);
  } finally { Module._load = original; }
  const view = {
    visible: true,
    webview: {
      cspSource: 'file:', html: '', options: {},
      asWebviewUri: value => value.toString(),
      onDidReceiveMessage: callback => { receiver = callback; return disposable; },
      postMessage: async message => { sent.push(message); return true; }
    },
    onDidDispose: callback => { disposedHandler = callback; return disposable; },
    onDidChangeVisibility: callback => { visibilityHandler = callback; return disposable; }
  };
  provider.resolveWebviewView(view);
  return {
    root, mock, settings, sent, view, provider, commands,
    send(message) { receiver(message); },
    disposeView() { disposedHandler(); },
    setVisible(visible) { view.visible = visible; visibilityHandler(); },
    dispose() { provider.dispose(); }
  };
}
async function until(predicate, timeout = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Condition timed out');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
module.exports = { createHost, until };
