'use strict';
// Node HTTPS transport for the pairing / app-list / launch adapters that the
// console app already uses. Keeping the protocol code identical to the console
// build means pairing cryptography is exercised by exactly one implementation.

const https = require('node:https');
const http = require('node:http');

const MAX_BODY = 1024 * 1024;

/**
 * @param {{host:string,port:number,path:string,identity?:object,
 *          pinnedCertificatePem?:string,timeoutMs?:number,signal?:AbortSignal,
 *          maxResponseBytes?:number}} options
 */
function requestHttps(options) {
  return new Promise((resolve, reject) => {
    const limit = options.maxResponseBytes || MAX_BODY;
    const requestOptions = {
      host: options.host,
      port: options.port,
      path: options.path,
      method: 'GET',
      // Sunshine uses a self-signed certificate; pinning the certificate that
      // was captured during pairing is the only validation available.
      ca: options.pinnedCertificatePem ? [options.pinnedCertificatePem] : undefined,
      rejectUnauthorized: Boolean(options.pinnedCertificatePem),
      timeout: options.timeoutMs || 15000,
      signal: options.signal,
      headers: { 'User-Agent': 'moonlight-brendanlauncher/1.0' },
    };
    if (options.identity) {
      const identity = options.identity;
      if (identity.p12Bytes && identity.p12Password) {
        requestOptions.pfx = Buffer.from(identity.p12Bytes, 'base64');
        requestOptions.passphrase = identity.p12Password;
      } else if (identity.certificatePem && identity.privateKeyPem) {
        requestOptions.cert = identity.certificatePem;
        requestOptions.key = identity.privateKeyPem;
      }
    }
    const request = https.request(requestOptions, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit) {
          request.destroy(Error(`Response from ${options.host} exceeded ${limit} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(Error(`HTTPS ${options.path.split('?')[0]} returned ${response.statusCode}`));
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    request.on('timeout', () => request.destroy(Error('HTTPS request timed out')));
    request.on('error', reject);
    request.end();
  });
}

function requestHttp(options) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: options.host,
        port: options.port,
        path: options.path,
        method: 'GET',
        timeout: options.timeoutMs || 10000,
        signal: options.signal,
      },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(Error(`HTTP ${options.path.split('?')[0]} returned ${response.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      },
    );
    request.on('timeout', () => request.destroy(Error('HTTP request timed out')));
    request.on('error', reject);
    request.end();
  });
}

module.exports = { requestHttp, requestHttps };
