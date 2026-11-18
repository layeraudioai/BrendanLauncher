'use strict';
// Moonlight control channel: AES-GCM encrypted messages over ENet.
//
// Sunshine always runs the "encrypted control stream" variant: every message is
// wrapped in an NVCTL_ENCRYPTED_PACKET_HEADER (type 0x0001, or 0x0002 "jumbo" for
// payloads that would overflow a 16-bit length), with AES-128-GCM keyed by the
// 16-byte rikey issued by /launch. The GCM tag is written *before* the
// ciphertext, and the 12-byte IV is seq(LE) || 'C' || 'C' client-to-host or
// seq(LE) || 'H' || 'C' host-to-client.
//
// Reference: moonlight-common-c src/ControlStream.c (populateOutgoingIv,
// encryptControlMessage, packetTypesGen7Enc).

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { EnetClient } = require('./enet.cjs');

const TAG_LENGTH = 16;

// Message types for Sunshine 7.1.431+ ("gen7 encrypted").
const TYPE = {
  requestIdr: 0x0302,
  startB: 0x0307,
  invalidateRefFrames: 0x0301,
  lossStats: 0x0201,
  frameStats: 0x0204,
  inputData: 0x0206,
  rumble: 0x010b,
  termination: 0x0109,
  hdrMode: 0x010e,
  terminationExtended: 0x0109,
};

// GameStream controller button bits (Limelight.h / Input.h).
const BUTTON = {
  up: 0x0001,
  down: 0x0002,
  left: 0x0004,
  right: 0x0008,
  start: 0x0010,
  back: 0x0020,
  leftStick: 0x0040,
  rightStick: 0x0080,
  leftShoulder: 0x0100,
  rightShoulder: 0x0200,
  guide: 0x0400,
  a: 0x1000,
  b: 0x2000,
  x: 0x4000,
  y: 0x8000,
};

class ControlStream extends EventEmitter {
  /**
   * @param {{host:string, port:number, rikey:Buffer, connectData?:number,
   *          logger?:(line:string)=>void}} options
   */
  constructor({ host, port, rikey, connectData = 0, logger = () => {} }) {
    super();
    this.host = host;
    this.port = port;
    this.rikey = Buffer.from(rikey);
    this.logger = logger;
    if (this.rikey.length !== 16) throw Error('Control stream key must be 16 bytes');
    this.enet = new EnetClient({ host, port, connectData });
    this.outgoingSequence = 0;
    this.incomingSequence = -1;
    this.started = false;
    this.stats = { sent: 0, received: 0, decrypted: 0, dropped: 0 };
  }

  async start() {
    this.enet.on('message', payload => this._onEncrypted(payload));
    this.enet.on('disconnected', () => this.emit('disconnected'));
    await this.enet.open();
    // START A / START B: Sunshine expects both before it accepts input.
    this.send(TYPE.requestIdr, Buffer.from([0, 0]));
    this.send(TYPE.startB, Buffer.from([0]));
    this.started = true;
    this.logger('control stream established');
    return this;
  }

  // -- crypto -------------------------------------------------------------
  _iv(sequence, hostOriginated) {
    const iv = Buffer.alloc(12);
    iv.writeUInt32LE(sequence >>> 0, 0);
    iv.writeUInt8(hostOriginated ? 0x48 : 0x43, 10); // 'H' or 'C'
    iv.writeUInt8(0x43, 11); // 'C' control stream
    return iv;
  }

  /** Wrap and send one control message. */
  send(type, payload) {
    if (!this.enet.connected) throw Error('Control stream is not connected');
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const sequence = this.outgoingSequence++ >>> 0;
    const iv = this._iv(sequence, false);
    const jumbo = data.length + 2 + TAG_LENGTH + 4 > 0xffff;
    const plain = Buffer.alloc((jumbo ? 2 : 4) + data.length);
    plain.writeUInt16LE(type, 0);
    if (!jumbo) plain.writeUInt16LE(data.length, 2);
    data.copy(plain, jumbo ? 2 : 4);
    const cipher = crypto.createCipheriv('aes-128-gcm', this.rikey, iv, { authTagLength: TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const head = Buffer.alloc(jumbo ? 10 : 8);
    head.writeUInt16LE(jumbo ? 0x0002 : 0x0001, 0);
    if (jumbo) {
      head.writeUInt32LE(4 + TAG_LENGTH + plain.length, 2);
      head.writeUInt32LE(sequence, 6);
    } else {
      head.writeUInt16LE(4 + TAG_LENGTH + plain.length, 2);
      head.writeUInt32LE(sequence, 4);
    }
    this.enet.send(Buffer.concat([head, tag, encrypted]), 0);
    this.stats.sent += 1;
  }

  _onEncrypted(payload) {
    try {
      const parsed = this._decrypt(payload);
      if (!parsed) return;
      this.stats.received += 1;
      this.emit('message', parsed);
    } catch (error) {
      this.stats.dropped += 1;
      this.logger(`control decrypt failed: ${error.message}`);
    }
  }

  _decrypt(payload) {
    if (payload.length < 8) return null;
    const marker = payload.readUInt16LE(0);
    let jumbo;
    let sequence;
    let length;
    let bodyOffset;
    if (marker === 0x0001) {
      jumbo = false;
      length = payload.readUInt16LE(2);
      sequence = payload.readUInt32LE(4);
      bodyOffset = 8;
    } else if (marker === 0x0002) {
      jumbo = true;
      length = payload.readUInt32LE(2);
      sequence = payload.readUInt32LE(6);
      bodyOffset = 10;
    } else {
      return null;
    }
    if (payload.length < bodyOffset + TAG_LENGTH) return null;
    // Replay protection: Sunshine's sequence numbers are monotonic per stream.
    if (this.incomingSequence >= 0 && sequence <= this.incomingSequence) return null;
    const tag = payload.subarray(bodyOffset, bodyOffset + TAG_LENGTH);
    const ciphertext = payload.subarray(bodyOffset + TAG_LENGTH, bodyOffset + length);
    if (ciphertext.length !== length - 4 - TAG_LENGTH) return null;
    const decipher = crypto.createDecipheriv('aes-128-gcm', this.rikey, this._iv(sequence, true), {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    this.incomingSequence = sequence;
    this.stats.decrypted += 1;
    const type = plain.readUInt16LE(0);
    if (jumbo) {
      return { type, payload: plain.subarray(2) };
    }
    const payloadLength = plain.readUInt16LE(2);
    if (payloadLength > plain.length - 4) return null;
    return { type, payload: plain.subarray(4, 4 + payloadLength) };
  }

  // -- input --------------------------------------------------------------
  /**
   * Send one controller state.
   * @param {{buttons:number,leftTrigger:number,rightTrigger:number,
   *          leftStickX:number,leftStickY:number,
   *          rightStickX:number,rightStickY:number}} state
   */
  sendController(state) {
    // NV_MULTI_CONTROLLER_PACKET, Sunshine ("gen5") layout, 36 bytes total.
    const BODY = 32;
    const packet = Buffer.alloc(4 + BODY);
    packet.writeUInt32BE(BODY, 0); // size excludes this field, big endian
    packet.writeUInt32LE(0x0000000c, 4); // MULTI_CONTROLLER_MAGIC_GEN5 (LE)
    packet.writeUInt16LE(0x001a, 8); // headerB
    packet.writeUInt16LE(0, 10); // controllerNumber
    packet.writeUInt16LE(0x0001, 12); // activeGamepadMask: player 0
    packet.writeUInt16LE(0x0014, 14); // midB
    packet.writeInt16LE(state.buttons | 0, 16);
    packet.writeUInt8(state.leftTrigger & 0xff, 18);
    packet.writeUInt8(state.rightTrigger & 0xff, 19);
    packet.writeInt16LE(clampStick(state.leftStickX), 20);
    packet.writeInt16LE(clampStick(state.leftStickY), 22);
    packet.writeInt16LE(clampStick(state.rightStickX), 24);
    packet.writeInt16LE(clampStick(state.rightStickY), 26);
    packet.writeInt16LE(0x009c, 28); // tailA
    packet.writeInt16LE(0, 30); // buttonFlags2 (Sunshine extension)
    packet.writeInt16LE(0x0055, 32); // tailB
    this.send(TYPE.inputData, packet);
  }

  sendKey(code, modifiers, down) {
    // NV_KEYBOARD_PACKET: size, magic, flags, keyCode, modifiers, zero.
    const BODY = 10;
    const packet = Buffer.alloc(4 + BODY);
    packet.writeUInt32BE(BODY, 0);
    packet.writeUInt32LE(down ? 0x00000003 : 0x00000004, 4);
    packet.writeInt8(0, 8); // flags (Sunshine extension)
    packet.writeInt16LE(code, 9);
    packet.writeInt8(modifiers, 11);
    packet.writeInt16LE(0, 12);
    this.send(TYPE.inputData, packet);
  }

  requestIdr() {
    try {
      this.send(TYPE.requestIdr, Buffer.from([0, 0]));
    } catch {
      /* stream already gone */
    }
  }

  stop() {
    try {
      if (this.enet.connected) this.send(TYPE.termination, Buffer.from([0]));
    } catch {
      /* ignore */
    }
    this.enet.disconnect();
  }
}

function clampStick(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-32767, Math.min(32767, Math.round(value)));
}

module.exports = { ControlStream, TYPE, BUTTON, TAG_LENGTH };
