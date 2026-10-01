
import test from 'node:test';
import assert from 'node:assert/strict';

function splitNals(data) {
  const nals = [];
  const len = data.length;
  let i = 0;
  const scPositions = [];

  while (i + 2 < len) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (i > 0 && data[i - 1] === 0) {
        scPositions.push({ pos: i - 1, scLen: 4 });
      } else {
        scPositions.push({ pos: i, scLen: 3 });
      }
      i += 3;
    } else {
      i++;
    }
  }

  for (let idx = 0; idx < scPositions.length; idx++) {
    const nalStart = scPositions[idx].pos + scPositions[idx].scLen;
    const nalEnd = idx + 1 < scPositions.length ? scPositions[idx + 1].pos : len;
    if (nalStart < nalEnd) {
      nals.push(data.subarray(nalStart, nalEnd));
    }
  }

  return nals;
}

function parseH264Config(nals) {
  const spsList = [];
  const ppsList = [];
  let codec = 'avc1.42001f';

  for (const nal of nals) {
    if (nal.length === 0) continue;
    const nalType = nal[0] & 0x1f;
    if (nalType === 7 && nal.length >= 4) {
      codec = `avc1.${nal[1].toString(16).padStart(2, '0')}${nal[2].toString(16).padStart(2, '0')}${nal[3].toString(16).padStart(2, '0')}`;
      spsList.push(nal);
    } else if (nalType === 8) {
      ppsList.push(nal);
    }
  }

  if (spsList.length === 0) {
    return { codec, description: new Uint8Array(0) };
  }

  const sps = spsList[0];
  const out = [
    1,
    sps[1],
    sps[2],
    sps[3],
    0xff,
    0xe0 | spsList.length,
  ];

  for (const s of spsList) {
    out.push((s.length >> 8) & 0xff);
    out.push(s.length & 0xff);
    for (let j = 0; j < s.length; j++) out.push(s[j]);
  }

  out.push(ppsList.length);
  for (const p of ppsList) {
    out.push((p.length >> 8) & 0xff);
    out.push(p.length & 0xff);
    for (let j = 0; j < p.length; j++) out.push(p[j]);
  }

  return { codec, description: new Uint8Array(out) };
}

function nalsToAvcc(data) {
  const nals = splitNals(data);
  if (nals.length === 0) return data;
  let totalLen = 0;
  for (const nal of nals) totalLen += 4 + nal.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const nal of nals) {
    const len = nal.length;
    out[offset] = (len >> 24) & 0xff;
    out[offset + 1] = (len >> 16) & 0xff;
    out[offset + 2] = (len >> 8) & 0xff;
    out[offset + 3] = len & 0xff;
    out.set(nal, offset + 4);
    offset += 4 + len;
  }
  return out;
}

test('parseH264Config extracts exact codec and valid avcC for Samsung A15', () => {
  const spsPpsRaw = Buffer.from('0000000167640020ac1b1a81e0207979a80808083c2211a80000000168ea43cb', 'hex');
  const nals = splitNals(spsPpsRaw);
  assert.equal(nals.length, 2);
  const { codec, description } = parseH264Config(nals);
  assert.equal(codec, 'avc1.640020');
  assert.ok(description.length > 20);
  assert.equal(description[0], 1); // configurationVersion
  assert.equal(description[1], 0x64); // profile
  assert.equal(description[2], 0x00); // compat
  assert.equal(description[3], 0x20); // level
});

test('parseH264Config extracts exact codec and valid avcC for Android Emulator Z_Fold', () => {
  const emuRaw = Buffer.from('000000016742c0298d680d8081e7e420202020f08846a00000000168ce01a835c8', 'hex');
  const nals = splitNals(emuRaw);
  assert.equal(nals.length, 2);
  const { codec, description } = parseH264Config(nals);
  assert.equal(codec, 'avc1.42c029');
  assert.ok(description.length > 20);
  assert.equal(description[0], 1);
  assert.equal(description[1], 0x42);
  assert.equal(description[2], 0xc0);
  assert.equal(description[3], 0x29);
});

test('nalsToAvcc converts 4-byte start codes to 4-byte length prefix', () => {
  const rawKeyFrame = Buffer.from('00000001650102030405', 'hex');
  const avcc = nalsToAvcc(rawKeyFrame);
  assert.equal(avcc.length, 4 + 6);
  assert.equal(avcc[0], 0);
  assert.equal(avcc[1], 0);
  assert.equal(avcc[2], 0);
  assert.equal(avcc[3], 6); // length 6
  assert.equal(avcc[4], 0x65); // NAL header IDR
});
