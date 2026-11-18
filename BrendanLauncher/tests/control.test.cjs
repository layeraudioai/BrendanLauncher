'use strict';
// Control channel crypto and packet layout, plus the ENet framing it rides on.

const crypto = require('node:crypto');
const path = require('node:path');
const { test, assert, equal, run } = require('./harness.cjs');
const MOON = path.join(__dirname, '..', 'apps', 'moonlight', 'host', 'moonlight');
const { ControlStream, BUTTON } = require(path.join(MOON, 'control.cjs'));
const { EnetClient } = require(path.join(MOON, 'enet.cjs'));

/** A control stream whose ENet peer is replaced by a recorder. */
function recorder(rikey) {
  const control = new ControlStream({ host: '127.0.0.1', port: 1, rikey: Buffer.from(rikey) });
  const sent = [];
  control.enet = { connected: true, send: data => sent.push(Buffer.from(data)), disconnect() {} };
  control.started = true;
  return { control, sent };
}

function iv(sequence, hostOriginated) {
  const value = Buffer.alloc(12);
  value.writeUInt32LE(sequence >>> 0, 0);
  value.writeUInt8(hostOriginated ? 0x48 : 0x43, 10);
  value.writeUInt8(0x43, 11);
  return value;
}

/** Build a host -> client control datagram the way Sunshine does. */
function hostMessage(rikey, { sequence = 0, type, payload }) {
  const cipher = crypto.createCipheriv('aes-128-gcm', rikey, iv(sequence, true), {
    authTagLength: 16,
  });
  const plain = Buffer.alloc(4 + payload.length);
  plain.writeUInt16LE(type, 0);
  plain.writeUInt16LE(payload.length, 2);
  payload.copy(plain, 4);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const head = Buffer.alloc(8);
  head.writeUInt16LE(0x0001, 0);
  head.writeUInt16LE(4 + 16 + plain.length, 2);
  head.writeUInt32LE(sequence, 4);
  return Buffer.concat([head, cipher.getAuthTag(), encrypted]);
}

/** Decrypt a client -> host datagram (what Sunshine would do). */
function decryptClientMessage(rikey, datagram) {
  const length = datagram.readUInt16LE(2);
  const sequence = datagram.readUInt32LE(4);
  const tag = datagram.subarray(8, 24);
  const ciphertext = datagram.subarray(24, 8 + length);
  const decipher = crypto.createDecipheriv('aes-128-gcm', rikey, iv(sequence, false), {
    authTagLength: 16,
  });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return { type: plain.readUInt16LE(0), payload: plain.subarray(4) };
}

test('outgoing messages use the V2 header, sequence and client IV', () => {
  const rikey = crypto.randomBytes(16);
  const { control, sent } = recorder(rikey);
  control.send(0x0206, Buffer.from([1, 2, 3, 4]));
  equal(sent.length, 1, 'one datagram');
  const datagram = sent[0];
  equal(datagram.readUInt16LE(0), 0x0001, 'V2 header marker');
  equal(datagram.readUInt16LE(2), 4 + 16 + 4 + 4, 'length covers header, tag, ciphertext');
  equal(datagram.readUInt32LE(4), 0, 'sequence zero');
  const decoded = decryptClientMessage(rikey, datagram);
  equal(decoded.type, 0x0206, 'message type');
  equal(decoded.payload.toString('hex'), '01020304', 'payload');
  control.send(0x0206, Buffer.from([5]));
  equal(sent[1].readUInt32LE(4), 1, 'sequence increments');
});

test('host messages decrypt and replays are rejected', () => {
  const rikey = crypto.randomBytes(16);
  const { control } = recorder(rikey);
  const received = [];
  control.on('message', message => received.push(message));
  const datagram = hostMessage(rikey, { sequence: 5, type: 0x0201, payload: Buffer.from([7, 7]) });
  control._onEncrypted(datagram);
  control._onEncrypted(datagram);
  equal(received.length, 1, 'replayed copy dropped');
  equal(received[0].type, 0x0201, 'type');
  equal(received[0].payload.toString('hex'), '0707', 'payload');
  const older = hostMessage(rikey, { sequence: 4, type: 0x0201, payload: Buffer.from([7]) });
  control._onEncrypted(older);
  equal(received.length, 1, 'older sequence dropped');
});

test('tampered ciphertext fails authentication', () => {
  const rikey = crypto.randomBytes(16);
  const { control } = recorder(rikey);
  let messages = 0;
  control.on('message', () => messages++);
  const datagram = Buffer.from(
    hostMessage(rikey, { sequence: 1, type: 0x0206, payload: Buffer.from([9, 9]) }),
  );
  datagram[datagram.length - 1] ^= 0xff;
  control._onEncrypted(datagram);
  equal(messages, 0, 'no message emitted for a bad tag');
  equal(control.stats.dropped, 1, 'failure counted');
});

test('controller packets match NV_MULTI_CONTROLLER_PACKET', () => {
  const rikey = crypto.randomBytes(16);
  const { control, sent } = recorder(rikey);
  control.sendController({
    buttons: BUTTON.a | BUTTON.down,
    leftTrigger: 0x80,
    rightTrigger: 0,
    leftStickX: -32768,
    leftStickY: 1234,
    rightStickX: 0,
    rightStickY: 0,
  });
  const { type, payload } = decryptClientMessage(rikey, sent[0]);
  equal(type, 0x0206, 'input data type');
  equal(payload.readUInt32BE(0), 32, 'size field excludes itself');
  equal(payload.readUInt32LE(4), 0x0000000c, 'MULTI_CONTROLLER_MAGIC_GEN5');
  equal(payload.readUInt16LE(12), 1, 'activeGamepadMask');
  equal(payload.readInt16LE(16), BUTTON.a | BUTTON.down, 'button bits');
  equal(payload.readUInt8(18), 0x80, 'left trigger');
  equal(payload.readInt16LE(20), -32767, 'left stick X clamped');
  equal(payload.readInt16LE(22), 1234, 'left stick Y');
  equal(payload.length, 36, 'full packet length');
});

test('ENet parses VERIFY_CONNECT, ACKs it and accepts reliable payloads', async () => {
  const client = new EnetClient({ host: '127.0.0.1', port: 9, channelCount: 48 });
  const datagrams = [];
  client._sendRaw = buffer => datagrams.push(Buffer.from(buffer));
  client.socket = null;
  client.closed = false;

  const verify = Buffer.alloc(4 + 40);
  verify.writeUInt16LE(0x8000, 0); // SENT_TIME flag, peer id 0 (unassigned)
  verify.writeUInt16LE(0x1234, 2); // sentTime
  verify.writeUInt8(3, 4); // VERIFY_CONNECT
  verify.writeUInt8(0, 5); // channel
  verify.writeUInt16LE(0, 6); // reliable sequence
  verify.writeUInt16LE(7, 8); // outgoingPeerID
  verify.writeUInt8(0, 10);
  verify.writeUInt8(3, 11); // outgoingSessionID
  verify.writeUInt32LE(1400, 12);
  verify.writeUInt32LE(65536, 16);
  verify.writeUInt32LE(48, 20);
  const connected = new Promise(resolve => client.once('connected', resolve));
  client._onDatagram(verify);
  await connected;
  equal(client.peerId, 7, 'peer id adopted');
  equal(client.sessionId, 3, 'session id adopted');
  equal(datagrams.length, 1, 'verify acknowledged');
  equal(datagrams[0].readUInt8(4) & 0x0f, 1, 'ACK command');

  const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const message = Buffer.alloc(4 + 4 + 2 + payload.length);
  message.writeUInt16LE(0x8000 | 7, 0);
  message.writeUInt16LE(0x4567, 2);
  message.writeUInt8(6, 4); // SEND_RELIABLE
  message.writeUInt8(0, 5);
  message.writeUInt16LE(4, 6);
  message.writeUInt16LE(payload.length, 8);
  payload.copy(message, 10);
  const received = new Promise(resolve => client.once('message', resolve));
  client._onDatagram(message);
  const got = await received;
  equal(got.toString('hex'), payload.toString('hex'), 'payload delivered');
  equal(datagrams.length, 2, 'data packet acknowledged');
  client.close();
});

test('oversized payloads are fragmented', () => {
  const client = new EnetClient({ host: '127.0.0.1', port: 9, channelCount: 48 });
  const datagrams = [];
  client._sendRaw = buffer => datagrams.push(Buffer.from(buffer));
  client.socket = null;
  client.closed = false;
  client.connected = true;
  client.peerId = 7;
  client.sessionId = 3;
  client.send(Buffer.alloc(5000, 0x5a), 0);
  assert(datagrams.length > 1, 'split across datagrams');
  client.close();
});

run('control.test.cjs').then(ok => {
  process.exitCode = ok ? 0 : 1;
});
