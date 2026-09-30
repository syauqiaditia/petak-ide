#!/usr/bin/env node
// Fake ACP agent for Petak tests: newline-delimited JSON-RPC 2.0 over stdio.
import readline from 'node:readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let activeSessions = new Map();
let currentPromptTimer = null;
let currentPromptResolve = null;

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

    if (promptText.startsWith('slow')) {
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
