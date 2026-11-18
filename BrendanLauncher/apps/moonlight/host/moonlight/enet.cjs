'use strict';
// Minimal ENet client (protocol v20) sufficient for Moonlight's control channel.
//
// Sunshine's control stream is an ENet peer on UDP 47999: reliable, ordered
// commands over a single overwrought framing. We implement the subset a client
// needs — CONNECT/VERIFY_CONNECT, SEND_RELIABLE in both directions, ACKs,
// fragments, ping and disconnect — and nothing else. Reference: the ENet
// protocol tables used by moonlight-common-c (enet/protocol.h).

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');

const PROTOCOL_VERSION = 20;
const MAX_PEER_ID = 0xfff;
const HEADER_FLAG_SENT_TIME = 0x8000;
const SESSION_MASK = 0x3000;
const SESSION_SHIFT = 12;

const COMMAND = {
  none: 0,
  acknowledge: 1,
  connect: 2,
  verifyConnect: 3,
  disconnect: 4,
  ping: 5,
  sendReliable: 6,
  sendUnreliable: 7,
  sendFragment: 8,
  sendUnsequenced: 9,
};
const COMMAND_FLAG_ACKNOWLEDGE = 0x80;
const COMMAND_FLAG_UNSEQUENCED = 0x40;
const COMMAND_MASK = 0x0f;

const MTU = 1400;
const WINDOW_SIZE = 65536;
const MAX_FRAGMENTS = 1024;

class EnetClient extends EventEmitter {
  constructor({ host, port, channelCount = 48, connectData = 0, timeoutMs = 5000 }) {
    super();
    this.host = host;
    this.port = port;
    this.channelCount = channelCount;
    this.connectData = connectData;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.peerId = MAX_PEER_ID;
    this.sessionId = 0xff;
    this.sentTime = 0;
    this.outgoingReliable = new Array(channelCount).fill(0);
    this.incomingReliable = new Array(channelCount).fill(0);
    this.fragments = new Map();
    this.connected = false;
    this.closed = false;
    this.stats = { sent: 0, received: 0, acks: 0, retransmits: 0 };
    this._pendingAcks = new Map();
    this._ackTimer = null;
    this._pingTimer = null;
  }

  // -- framing ------------------------------------------------------------
  _header(buffer, sentTime) {
    const peer = this.peerId & MAX_PEER_ID;
    const withTime = HEADER_FLAG_SENT_TIME | ((this.sessionId & 3) << SESSION_SHIFT) | peer;
    if (!sentTime) {
      const head = Buffer.alloc(2);
      head.writeUInt16LE(withTime & ~HEADER_FLAG_SENT_TIME, 0);
      return Buffer.concat([head, buffer]);
    }
    const head = Buffer.alloc(4);
    head.writeUInt16LE(withTime, 0);
    head.writeUInt16LE(sentTime & 0xffff, 2);
    return Buffer.concat([head, buffer]);
  }

  _command(command, channelId, reliable, body) {
    const head = Buffer.alloc(4);
    head.writeUInt8(command, 0);
    head.writeUInt8(channelId, 1);
    head.writeUInt16LE(reliable & 0xffff, 2);
    return Buffer.concat([head, body]);
  }

  _connectCommand() {
    const body = Buffer.alloc(44);
    body.writeUInt16LE(MAX_PEER_ID, 0);
    body.writeUInt8(0xff, 2);
    body.writeUInt8(0xff, 3);
    body.writeUInt32LE(MTU, 4);
    body.writeUInt32LE(WINDOW_SIZE, 8);
    body.writeUInt32LE(this.channelCount, 12);
    body.writeUInt32LE(0, 16); // incoming bandwidth
    body.writeUInt32LE(0, 20); // outgoing bandwidth
    body.writeUInt32LE(5000, 24); // throttle interval
    body.writeUInt32LE(2, 28); // throttle acceleration
    body.writeUInt32LE(2, 32); // throttle deceleration
    body.writeUInt32LE(this.connectData >>> 0, 36);
    body.writeUInt32LE(0, 40); // data
    // CONNECT carries no reliable sequence number semantics on the wire.
    const head = Buffer.alloc(4);
    head.writeUInt8(COMMAND.connect, 0);
    head.writeUInt8(0xff, 1);
    head.writeUInt16LE(0, 2);
    return Buffer.concat([head, body]);
  }

  // -- lifecycle ----------------------------------------------------------
  open() {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        this.close();
        reject(Error(`ENet connect to ${this.host}:${this.port} timed out`));
      }, this.timeoutMs);
      this.socket.on('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      this.socket.on('message', message => this._onDatagram(message));
      this.socket.bind(0, () => {
        this._sendRaw(this._connectCommand());
        this._retryTimer = setTimeout(() => {
          if (!this.connected) this._sendRaw(this._connectCommand());
        }, 500);
        this.once('connected', () => {
          clearTimeout(timer);
          clearTimeout(this._retryTimer);
          resolve(this);
        });
      });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearInterval(this._ackTimer);
    clearInterval(this._pingTimer);
    clearTimeout(this._retryTimer);
    try {
      if (this.socket) this.socket.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
  }

  // -- send path ----------------------------------------------------------
  _sendRaw(buffer) {
    if (!this.socket || this.closed) return;
    this.socket.send(buffer, this.port, this.host, () => {});
    this.stats.sent += 1;
  }

  _sendCommand(command, channelId, body, { acknowledge = true } = {}) {
    const sequence = this.outgoingReliable[channelId];
    if (acknowledge) {
      this.outgoingReliable[channelId] = (sequence + 1) & 0xffff;
      this._pendingAcks.set(`${channelId}:${sequence}`, this._now());
    }
    const head = Buffer.alloc(4);
    head.writeUInt8(command | (acknowledge ? COMMAND_FLAG_ACKNOWLEDGE : 0), 0);
    head.writeUInt8(channelId, 1);
    head.writeUInt16LE(sequence, 2);
    return { packet: this._header(Buffer.concat([head, body]), true), sequence };
  }

  _now() {
    const now = process.hrtime.bigint() / 1000000n;
    return Number(now & 0xffffn);
  }

  /** Reliable ordered send. Large payloads are fragmented. */
  send(data, channelId = 0) {
    if (!this.connected) throw Error('ENet peer is not connected');
    const room = MTU - 4 /* header */ - 20;
    if (data.length <= room) {
      const body = Buffer.alloc(2 + data.length);
      body.writeUInt16LE(data.length, 0);
      data.copy(body, 2);
      const { packet } = this._sendCommand(COMMAND.sendReliable, channelId, body);
      this._sendRaw(packet);
      return;
    }
    const startSequence = this.outgoingReliable[channelId];
    const fragmentCount = Math.min(MAX_FRAGMENTS, Math.ceil(data.length / room));
    for (let index = 0; index < fragmentCount; index++) {
      const offset = index * room;
      const slice = data.subarray(offset, Math.min(data.length, offset + room));
      const body = Buffer.alloc(20 + slice.length);
      body.writeUInt16LE(startSequence, 0);
      body.writeUInt16LE(slice.length, 2);
      body.writeUInt32LE(fragmentCount, 4);
      body.writeUInt32LE(index, 8);
      body.writeUInt32LE(data.length, 12);
      body.writeUInt32LE(offset, 16);
      slice.copy(body, 20);
      const { packet } = this._sendCommand(COMMAND.sendFragment, channelId, body);
      this._sendRaw(packet);
    }
  }

  // -- receive path -------------------------------------------------------
  _onDatagram(message) {
    if (message.length < 4) return;
    let offset = 0;
    const flags = message.readUInt16LE(0);
    const peerField = flags & ~(HEADER_FLAG_SENT_TIME | SESSION_MASK);
    offset += 2;
    let sentTime = 0;
    if (flags & HEADER_FLAG_SENT_TIME) {
      sentTime = message.readUInt16LE(2);
      offset += 2;
    }
    // Before the handshake completes our peer id is unassigned, so accept any
    // peer id until VERIFY_CONNECT tells us which one the host picked.
    if (this.peerId !== MAX_PEER_ID && peerField !== MAX_PEER_ID && peerField !== this.peerId) {
      return;
    }

    while (offset + 4 <= message.length) {
      const commandByte = message.readUInt8(offset);
      const command = commandByte & COMMAND_MASK;
      const channelId = message.readUInt8(offset + 1);
      const reliableSequence = message.readUInt16LE(offset + 2);
      offset += 4;
      const acknowledges = (commandByte & COMMAND_FLAG_ACKNOWLEDGE) !== 0;
      const next = this._handleCommand(command, channelId, reliableSequence, message, offset, {
        acknowledges,
        sentTime,
      });
      if (next === null) return;
      offset = next;
    }
  }

  _handleCommand(command, channelId, sequence, message, offset, meta) {
    switch (command) {
      case COMMAND.none:
        return message.length;
      case COMMAND.acknowledge: {
        const body = message.subarray(offset, offset + 4);
        if (body.length < 4) return message.length;
        this._pendingAcks.delete(`${channelId}:${body.readUInt16LE(0)}`);
        this.stats.acks += 1;
        return offset + 4;
      }
      case COMMAND.verifyConnect: {
        // ENetProtocolVerifyConnect: outgoingPeerID(2), in/out session ids(1+1),
        // mtu, window, channels, three throttle values, connectID, data.
        const body = message.subarray(offset, offset + 36);
        if (body.length < 36) return message.length;
        this.peerId = body.readUInt16LE(0) & MAX_PEER_ID;
        this.sessionId = body.readUInt8(3);
        this._ack(channelId, sequence, meta.sentTime);
        this.connected = true;
        this._startKeepalive();
        this.emit('connected');
        return offset + 36;
      }
      case COMMAND.connect: {
        // Server-initiated connect is not part of the Moonlight flow.
        return message.length;
      }
      case COMMAND.disconnect: {
        this.connected = false;
        this.emit('disconnected');
        return message.length;
      }
      case COMMAND.ping: {
        this._ack(channelId, sequence, meta.sentTime);
        return offset;
      }
      case COMMAND.sendReliable: {
        const length = message.readUInt16LE(offset);
        const payload = message.subarray(offset + 2, offset + 2 + length);
        this._ack(channelId, sequence, meta.sentTime);
        this.stats.received += 1;
        this.emit('message', payload, channelId);
        return offset + 2 + length;
      }
      case COMMAND.sendUnreliable: {
        const length = message.readUInt16LE(offset);
        const payload = message.subarray(offset + 2, offset + 2 + length);
        this.emit('message', payload, channelId);
        return offset + 2 + length;
      }
      case COMMAND.sendUnsequenced: {
        const length = message.readUInt16LE(offset);
        this.emit('message', message.subarray(offset + 2, offset + 2 + length), channelId);
        return offset + 2 + length;
      }
      case COMMAND.sendFragment: {
        const fragment = this._readFragment(message, offset);
        if (!fragment) return message.length;
        this._ack(channelId, sequence, meta.sentTime);
        const assembled = this._assemble(channelId, fragment);
        if (assembled) this.emit('message', assembled, channelId);
        return offset + 20 + fragment.length;
      }
      case COMMAND.bandwidthLimit:
        return offset + 12;
      case COMMAND.throttleConfigure:
        return offset + 16;
      default:
        // Unknown command: stop parsing this datagram rather than guessing at
        // a length we do not know.
        return message.length;
    }
  }

  _readFragment(message, offset) {
    if (offset + 20 > message.length) return null;
    const view = message.subarray(offset, offset + 20);
    const length = view.readUInt16LE(2);
    const fragmentCount = view.readUInt32LE(4);
    const fragmentNumber = view.readUInt32LE(8);
    const totalLength = view.readUInt32LE(12);
    const fragmentOffset = view.readUInt32LE(16);
    const data = message.subarray(offset + 20, offset + 20 + length);
    if (data.length !== length) return null;
    return {
      start: view.readUInt16LE(0),
      fragmentCount,
      fragmentNumber,
      totalLength,
      fragmentOffset,
      data,
    };
  }

  _assemble(channelId, fragment) {
    const key = `${channelId}:${fragment.start}`;
    let entry = this.fragments.get(key);
    if (!entry) {
      entry = { total: fragment.totalLength, parts: new Map(), count: fragment.fragmentCount };
      this.fragments.set(key, entry);
    }
    entry.parts.set(fragment.fragmentNumber, fragment.data);
    if (entry.parts.size < entry.count) return null;
    this.fragments.delete(key);
    const ordered = [...entry.parts.entries()].sort((a, b) => a[0] - b[0]).map(part => part[1]);
    const joined = Buffer.concat(ordered);
    return joined.length === entry.total ? joined : null;
  }

  _ack(channelId, sequence, sentTime) {
    const body = Buffer.alloc(4);
    body.writeUInt16LE(sequence, 0);
    body.writeUInt16LE(sentTime, 2);
    const head = Buffer.alloc(4);
    head.writeUInt8(COMMAND.acknowledge, 0);
    head.writeUInt8(channelId, 1);
    head.writeUInt16LE(0, 2);
    this._sendRaw(this._header(Buffer.concat([head, body]), true));
  }

  _startKeepalive() {
    this._pingTimer = setInterval(() => {
      if (!this.connected) return;
      const head = Buffer.alloc(4);
      head.writeUInt8(COMMAND.ping, 0);
      head.writeUInt8(0xff, 1);
      head.writeUInt16LE(0, 2);
      this._sendRaw(this._header(head, true));
    }, 500);
    this._pingTimer.unref?.();
  }

  disconnect() {
    if (!this.connected) {
      this.close();
      return;
    }
    const head = Buffer.alloc(4);
    head.writeUInt8(COMMAND.disconnect | COMMAND_FLAG_ACKNOWLEDGE, 0);
    head.writeUInt8(0, 1);
    head.writeUInt16LE(0, 2);
    this._sendRaw(this._header(head, true));
    this.connected = false;
    this.close();
  }
}

module.exports = {
  EnetClient,
  PROTOCOL_VERSION,
  MTU,
  COMMAND,
  COMMAND_FLAG_ACKNOWLEDGE,
  COMMAND_FLAG_UNSEQUENCED,
};
