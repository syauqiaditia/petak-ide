#!/usr/bin/env node
// Fake ACP agent for Petak tests: newline-delimited JSON-RPC 2.0 over stdio.
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let activeSessions = new Map();
let currentPromptTimer = null;
let currentPromptResolve = null;
let pendingRpc = new Map();
let nextRpcId = 9000;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    send({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: ' + String(err) },
    });
    return;
  }

  // Check if this is a response to our client-initiated RPC request
  if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
    if (pendingRpc.has(msg.id)) {
      const cb = pendingRpc.get(msg.id);
      pendingRpc.delete(msg.id);
      cb(msg);
      return;
    }
  }

  // Handle requests / notifications
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentInfo: {
          name: 'fake-acp-agent',
          version: '1.0.0',
        },
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
          },
          sessionCapabilities: {
            fork: {},
            list: {},
            resume: {},
          },
        },
        authMethods: [
          {
            id: 'mock-auth',
            name: 'Mock Auth',
            description: 'Mock auth method for tests',
          },
        ],
      },
    });
  } else if (msg.method === 'session/new') {
    const sessionId = 'fake-session-' + Math.floor(Math.random() * 1000000);
    activeSessions.set(sessionId, { cwd: msg.params?.cwd || '' });
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        sessionId,
        models: {
          currentModelId: 'fake-model-alpha',
          availableModels: [
            {
              modelId: 'fake-model-alpha',
              name: 'Fake Model Alpha',
              description: 'Primary fake model',
            },
            {
              modelId: 'fake-model-beta',
              name: 'Fake Model Beta',
              description: 'Fallback fake model',
            },
          ],
        },
        modes: {
          currentModeId: 'default',
          availableModes: [
            { id: 'default', name: 'Default', description: 'Standard mode' },
          ],
        },
      },
    });
  } else if (msg.method === 'session/prompt') {
    const sessionId = msg.params?.sessionId;
    const promptText = msg.params?.prompt?.[0]?.text || '';

    if (promptText.startsWith('perm:')) {
      const cmd = promptText.slice(5);
      const rpcId = ++nextRpcId;
      pendingRpc.set(rpcId, (resp) => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            stopReason: 'end_turn',
            usage: { inputTokens: 10, outputTokens: 5 },
            _meta: { permResult: resp.result, permError: resp.error },
          },
        });
      });
      send({
        jsonrpc: '2.0',
        id: rpcId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: {
            tool: 'bash',
            arguments: { command: cmd },
            command: cmd,
          },
        },
      });
    } else if (promptText.startsWith('write:')) {
      const rest = promptText.slice(6);
      const colonIdx = rest.indexOf(':');
      const path = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
      const content = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';

      const rpcId = ++nextRpcId;
      pendingRpc.set(rpcId, (resp) => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            stopReason: 'end_turn',
            usage: { inputTokens: 12, outputTokens: 6 },
            _meta: { writeResult: resp.result, writeError: resp.error },
          },
        });
      });
      send({
        jsonrpc: '2.0',
        id: rpcId,
        method: 'fs/write_text_file',
        params: {
          sessionId,
          path,
          content,
        },
      });
    } else if (promptText.startsWith('read:')) {
      const path = promptText.slice(5);
      const rpcId = ++nextRpcId;
      pendingRpc.set(rpcId, (resp) => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            stopReason: 'end_turn',
            usage: { inputTokens: 8, outputTokens: 4 },
            _meta: { readResult: resp.result, readError: resp.error },
          },
        });
      });
      send({
        jsonrpc: '2.0',
        id: rpcId,
        method: 'fs/read_text_file',
        params: {
          sessionId,
          path,
        },
      });
    } else if (promptText.startsWith('slow')) {
      // Stream updates slowly so cancel can be tested
      let count = 0;
      currentPromptTimer = setInterval(() => {
        count++;
        send({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: `chunk-${count} ` },
            },
          },
        });
        if (count >= 20) {
          clearInterval(currentPromptTimer);
          currentPromptTimer = null;
          send({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              stopReason: 'end_turn',
              usage: { inputTokens: 50, outputTokens: 20 },
            },
          });
        }
      }, 100);

      currentPromptResolve = (cancelled) => {
        if (currentPromptTimer) {
          clearInterval(currentPromptTimer);
          currentPromptTimer = null;
        }
        if (cancelled) {
          send({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              stopReason: 'cancelled',
              usage: { inputTokens: 10, outputTokens: count },
            },
          });
        }
      };
    } else if (promptText.startsWith('subproc')) {
      const child = spawn('sleep', ['60']);
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `child_pid:${child.pid}` },
          },
        },
      });
      currentPromptResolve = (cancelled) => {
        if (cancelled) {
          send({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              stopReason: 'cancelled',
              usage: { inputTokens: 5, outputTokens: 5 },
            },
          });
        }
      };
    } else if (promptText.startsWith('stuck') || promptText.startsWith('hang')) {
      // Intentionally do nothing to simulate stuck process / idle timeout
    } else {
      // Normal quick prompt: stream chunks and usage, then finish
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Echo: ' },
          },
        },
      });
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: promptText },
          },
        },
      });
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'usage_update',
            usage: {
              inputTokens: 15,
              outputTokens: 7,
            },
          },
        },
      });
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          stopReason: 'end_turn',
          usage: { inputTokens: 15, outputTokens: 7 },
          _meta: { fake: true },
        },
      });
    }
  } else if (msg.method === 'session/cancel') {
    if (currentPromptResolve) {
      currentPromptResolve(true);
      currentPromptResolve = null;
    }
  } else if (msg.method === 'test/hang') {
    // Hang intentionally: do not reply to simulate hanging request
  } else if (msg.id !== undefined && msg.id !== null) {
    // Unhandled request
    send({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
  }
});

process.on('SIGTERM', () => {
  if (currentPromptTimer) clearInterval(currentPromptTimer);
  process.exit(0);
});

process.on('SIGINT', () => {
  if (currentPromptTimer) clearInterval(currentPromptTimer);
  process.exit(0);
});
