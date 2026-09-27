import { mount } from 'svelte';
import App from './App.svelte';
import { api } from './lib/api';

const formatArg = (a: any) => {
  if (a instanceof Error) {
    return `${a.name}: ${a.message}\n${a.stack}`;
  }
  if (typeof a === 'object' && a !== null) {
    try {
      const s = JSON.stringify(a);
      if (s === '{}') {
        return (a.message || a.toString()) + ' ' + Object.getOwnPropertyNames(a).map(k => `${k}=${a[k]}`).join(', ');
      }
      return s;
    } catch (_) {
      return String(a);
    }
  }
  return String(a);
};

window.addEventListener('error', (e) => {
  api.benchLog('[WINDOW_ERROR] ' + e.message + ' at ' + e.filename + ':' + e.lineno + '\n' + (e.error?.stack || ''));
});
window.addEventListener('unhandledrejection', (e) => {
  api.benchLog('[UNHANDLED] ' + formatArg(e.reason));
});
const origLog = console.log;
console.log = (...args) => {
  origLog(...args);
  try {
    api.benchLog('[LOG] ' + args.map(formatArg).join(' '));
  } catch (_) {}
};
const origErr = console.error;
console.error = (...args) => {
  origErr(...args);
  try {
    api.benchLog('[ERROR_LOG] ' + args.map(formatArg).join(' '));
  } catch (_) {}
};

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
