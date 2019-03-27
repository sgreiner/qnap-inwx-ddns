/**
 * Copyright (c) 2018, Stefan Greiner
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/**
 * This script creates and updates Resource Records within the INWX.de API.
 * The intended purpuse is to keep them up to date like DynDNS does.
 */

/**
 * Add to /etc/config/crontab:
 * * * * * * /usr/local/bin/node /share/CE_CACHEDEV1_DATA/Files/QNAP/scripts/update-inwx-dns/app.js
 */

// Documentation inwx node module: https://github.com/mattes/inwx-nodejs
// Documentation inwx API: https://www.inwx.de/en/help/apidoc/

const dns = require('dns');
const fs = require('fs');
const os = require('os');
const inwx = require('inwx');

const doDebug = false;

const API_USER = '';
const API_PASSWORD = '';
const DOMAIN = '';
const FQDN_TO_UPDATE = 'nas.' + DOMAIN;
const FQDN_TO_QUERY_V4 = 'ovpn.' + DOMAIN;
const TTL = 300;

const INTERFACE_NAME = 'eth0';
const FILEPATH_SAVED_IP_ENTRIES = '/tmp/savedIpEntries.json';

const API_VERSION = {
    PRODUCTION: 'production',
    TESTING: 'testing',
};

const API_CONFIG = {
    api: API_VERSION.PRODUCTION,
    user: API_USER,
    password: API_PASSWORD,
};

const NETWORK_INTERFACES = os.networkInterfaces();
if (!NETWORK_INTERFACES.hasOwnProperty(INTERFACE_NAME)) {
    throw new Error('Interface ' + INTERFACE_NAME + ' does not exist.');
}

const utcTime = new Date().toUTCString();

function debugInfo(msg) {
    if (doDebug) console.info(msg);
}

function debugLog(msg) {
    if (doDebug) console.log(msg);
}

function debugError(msg) {
    if (doDebug) console.error(msg);
}

async function nameserverInfo(api, type, name) {
    let promise = new Promise((resolve, reject) => {
        api.call('nameserver', 'info', {
            domain: DOMAIN,
            type: type,
            name: name,
        }, (response) => {
            resolve(response);
        }, (error) => {
            reject(error);
        });
    });
    return promise;
}

async function createRecord(api, content, type, name) {
    let promise = new Promise((resolve, reject) => {
        api.nameserverRecordHelper(
            DOMAIN,
            'create', {
                content: content,
                type: type,
                name: name,
                ttl: TTL,
            }, (response) => {
                resolve(response);
            }, (error) => {
                reject(error);
            }
        );
    });
    return promise;
};

async function updateRecord(api, content, type, name) {
    let promise = new Promise((resolve, reject) => {
        api.nameserverRecordHelper(
            DOMAIN,
            'update', {
                content: content,
                ttl: TTL,
            }, {
                type: type,
                name: name,
            }, (response) => {
                resolve(response);
            }, (error) => {
                reject(error);
            }
        );
    });
    return promise;
};

async function dnsLookupV4(lookupAddress) {
    let promise = new Promise((resolve, reject) => {
        dns.setServers([
            '9.9.9.9',
            '149.112.112.112',
            '[2620:fe::fe]',
            '[2620:fe::9]',
        ]);
        dns.lookup(lookupAddress, 4, (error, addressV4, family) => {
            if (error) {
                reject(error);
            } else {
                resolve(addressV4);
            }
        });
    });
    return promise;
};

async function doUpdate(api, currentIpEntries) {
    try {
        for (let entry of currentIpEntries) {
            try {
                let info = await nameserverInfo(
                    api,
                    entry.type,
                    FQDN_TO_UPDATE
                );
                if (typeof info.record !== 'undefined' &&
                    info.record.length > 0
                ) {
                    await updateRecord(
                        api,
                        entry.address,
                        entry.type,
                        FQDN_TO_UPDATE
                    );
                    debugInfo('Updated: ' +
                        FQDN_TO_UPDATE + ' ' +
                        entry.type + ' ' +
                        entry.address
                    );
                } else {
                    await createRecord(
                        api,
                        entry.address,
                        entry.type,
                        FQDN_TO_UPDATE
                    );
                    debugInfo('Created: ' +
                        FQDN_TO_UPDATE + ' ' +
                        entry.type + ' ' +
                        entry.address
                    );
                }
            } catch (error) {
                throw error;
            }
        }
        debugLog('Success!');
    } catch (error) {
        debugError(error);
    } finally {
        api.close();
    }
};

async function main() {
    let currentIpEntries = [];
    currentIpEntries = NETWORK_INTERFACES[INTERFACE_NAME].filter((entry) => {
        return entry.address.startsWith('2001:');
    }).map((entry) => {
        return {
            address: entry.address,
            type: 'AAAA',
        };
    });

    try {
        currentIpEntries.push({
            address: await dnsLookupV4(FQDN_TO_QUERY_V4),
            type: 'A',
        });
    } catch (error) {
        debugError(error);
    }

    let savedIpEntries = [];
    try {
        let data = fs.readFileSync(FILEPATH_SAVED_IP_ENTRIES, {
            encoding: 'utf8',
            flag: 'r',
        });
        savedIpEntries = JSON.parse(data);
    } catch (error) {
        debugError(error);
        savedIpEntries = false;
    }

    let savedIpEntriesStringified = JSON.stringify(savedIpEntries);
    let currentIpEntriesStringified = JSON.stringify(currentIpEntries);

    debugLog(utcTime);
    if (savedIpEntriesStringified !== currentIpEntriesStringified) {
        debugLog('IP changes detected!');
        inwx(API_CONFIG, (api) => {
            doUpdate(api, currentIpEntries);
        });
        fs.writeFile(
            FILEPATH_SAVED_IP_ENTRIES,
            currentIpEntriesStringified,
            {
                encoding: 'utf8',
                flag: 'w',
            },
            (error) => {
                if (error) debugError(error);
            }
        );
    } else {
        debugLog('Nothing to do!');
    }
}

main();
