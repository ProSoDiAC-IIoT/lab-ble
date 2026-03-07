/**
 * ============================================================
 *  BLE Lab Explorer — peripheral.js
 *  Virtual BLE Peripheral Simulator
 *
 *  This module is a JavaScript mock of the Web Bluetooth API.
 *  When Simulation Mode is enabled it replaces navigator.bluetooth
 *  so that students can explore the full GATT flow (scan, connect,
 *  discover, read, write, notify) without any physical BLE hardware.
 *
 *  HOW IT WORKS
 *  ─────────────────────────────────────────────────────────
 *  The Web Bluetooth API is built around a hierarchy:
 *    BluetoothDevice
 *      └── BluetoothRemoteGATTServer
 *            └── BluetoothRemoteGATTService (one per service)
 *                  └── BluetoothRemoteGATTCharacteristic (one per char)
 *
 *  This file recreates all four levels as plain JavaScript
 *  objects/classes so that app.js needs zero changes — it
 *  calls the same methods and receives the same types.
 *
 *  VIRTUAL DEVICE LAYOUT
 *  ─────────────────────────────────────────────────────────
 *  Service: Battery Service           (0x0000180f-…)
 *    └─ battery_level                 (0x00002a19-…) READ + NOTIFY
 *
 *  Service: Environmental Sensing     (0x0000181a-…)
 *    └─ temperature                   (0x00002a6e-…) READ + NOTIFY
 *
 *  Service: Lab Custom Service        (0x0000ffff-…)
 *    ├─ lab_rw_char                   (0x0000ff01-…) READ + WRITE
 *    └─ lab_notify_char               (0x0000ff02-…) READ + NOTIFY
 * ============================================================
 */

'use strict';

/* ============================================================
   UTILITY — convert a number to a DataView (Uint8Array wrapper)
   This is what the real API returns for .readValue().
   ============================================================ */
function numberToDataView(value, bytes = 1) {
    const buffer = new ArrayBuffer(bytes);
    const view = new DataView(buffer);
    if (bytes === 1) view.setUint8(0, value & 0xFF);
    if (bytes === 2) view.setInt16(0, value, true); // little-endian
    return view;
}

function stringToDataView(str) {
    const encoded = new TextEncoder().encode(str);
    return new DataView(encoded.buffer);
}

/* ============================================================
   MOCK CHARACTERISTIC
   Mimics BluetoothRemoteGATTCharacteristic exactly.
   ============================================================ */
class MockCharacteristic {
    /**
     * @param {string} uuid         - Full 128-bit UUID string
     * @param {object} properties   - { read, write, notify, ... }
     * @param {Function} getValue   - Returns current DataView value
     * @param {Function} [onWrite]  - Called when central writes a value
     * @param {number}  [notifyMs]  - Auto-notify interval in ms (0 = disabled)
     * @param {Function} [getNotifyValue] - Returns DataView for each notification
     */
    constructor({ uuid, properties, getValue, onWrite, notifyMs, getNotifyValue }) {
        this.uuid = uuid;
        this.properties = {
            read: false,
            write: false,
            writeWithoutResponse: false,
            notify: false,
            indicate: false,
            broadcast: false,
            authenticatedSignedWrites: false,
            reliableWrite: false,
            writableAuxiliaries: false,
            ...properties,
        };
        this._getValue = getValue;
        this._onWrite = onWrite || (() => { });
        this._notifyMs = notifyMs || 0;
        this._getNotifyValue = getNotifyValue || getValue;
        this._listeners = {};   // event → [callback, ...]
        this._notifyTimer = null;
        this.value = null; // updated after readValue / on notify
    }

    /* ── READ ──────────────────────────────────────────────── */
    async readValue() {
        await _delay(120); // simulate BLE round-trip latency
        this.value = this._getValue();
        return this.value;
    }

    /* ── WRITE (with response) ─────────────────────────────── */
    async writeValueWithResponse(buffer) {
        await _delay(80);
        this._onWrite(buffer);
        return;
    }

    /* ── WRITE (without response) ──────────────────────────── */
    async writeValueWithoutResponse(buffer) {
        await _delay(20);
        this._onWrite(buffer);
        return;
    }

    /* ── SUBSCRIBE (start notifications) ──────────────────── */
    async startNotifications() {
        if (this._notifyTimer) return this;
        await _delay(60);
        this._notifyTimer = setInterval(() => {
            this.value = this._getNotifyValue();
            this._emit('characteristicvaluechanged', { target: this });
        }, this._notifyMs);
        return this;
    }

    /* ── UNSUBSCRIBE (stop notifications) ──────────────────── */
    async stopNotifications() {
        clearInterval(this._notifyTimer);
        this._notifyTimer = null;
        await _delay(40);
        return this;
    }

    /* ── EventTarget shim ───────────────────────────────────── */
    addEventListener(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
    }

    removeEventListener(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }

    _emit(event, detail) {
        (this._listeners[event] || []).forEach(cb => cb(detail));
    }
}

/* ============================================================
   MOCK SERVICE
   Mimics BluetoothRemoteGATTService.
   ============================================================ */
class MockService {
    constructor(uuid, characteristics) {
        this.uuid = uuid;
        this.isPrimary = true;
        this._characteristics = characteristics; // array of MockCharacteristic
    }

    async getCharacteristics() {
        await _delay(150);
        return this._characteristics;
    }
}

/* ============================================================
   MOCK GATT SERVER
   Mimics BluetoothRemoteGATTServer.
   ============================================================ */
class MockGATTServer {
    constructor(device, services) {
        this.device = device;
        this.connected = false;
        this._services = services;
    }

    async connect() {
        await _delay(600); // simulate BLE connection time
        this.connected = true;
        this.device.gatt = this;
        return this;
    }

    async getPrimaryServices() {
        await _delay(300);
        return this._services;
    }

    disconnect() {
        this.connected = false;
        // stop all running notification timers on disconnect
        this._services.forEach(svc =>
            svc._characteristics.forEach(c => clearInterval(c._notifyTimer))
        );
    }
}

/* ============================================================
   VIRTUAL DEVICE DEFINITION
   Change values here to customise the simulated peripheral.
   ============================================================ */

/* ── 1. Battery Service (0x180F) ─────────────────────────── */
let _batteryLevel = 87; // starts at 87%

const batteryLevelChar = new MockCharacteristic({
    uuid: '00002a19-0000-1000-8000-00805f9b34fb',
    properties: { read: true, notify: true },
    getValue: () => numberToDataView(_batteryLevel, 1),
    getNotifyValue: () => {
        // Slowly drain the battery over time
        _batteryLevel = Math.max(0, _batteryLevel - 1);
        return numberToDataView(_batteryLevel, 1);
    },
    notifyMs: 3000, // push every 3 seconds
});

const batteryService = new MockService(
    '0000180f-0000-1000-8000-00805f9b34fb',
    [batteryLevelChar]
);

/* ── 2. Environmental Sensing (0x181A) ───────────────────── */
// Temperature: stored as int16, unit = 0.01 °C  →  2150 = 21.50 °C
let _tempRaw = 2150;

const temperatureChar = new MockCharacteristic({
    uuid: '00002a6e-0000-1000-8000-00805f9b34fb',
    properties: { read: true, notify: true },
    getValue: () => numberToDataView(_tempRaw, 2),
    getNotifyValue: () => {
        // Fluctuate ±0.20 °C randomly
        _tempRaw += Math.round((Math.random() - 0.5) * 40);
        _tempRaw = Math.max(1500, Math.min(4000, _tempRaw)); // clamp 15–40 °C
        return numberToDataView(_tempRaw, 2);
    },
    notifyMs: 2000, // push every 2 seconds
});

const envService = new MockService(
    '0000181a-0000-1000-8000-00805f9b34fb',
    [temperatureChar]
);

/* ── 3. Custom Lab Service (0xFFFF) ──────────────────────── */
let _labRWValue = stringToDataView('hello');
let _labCounter = 0;

// READ + WRITE characteristic — stores whatever the student writes
const labRWChar = new MockCharacteristic({
    uuid: '0000ff01-0000-1000-8000-00805f9b34fb',
    properties: { read: true, write: true, writeWithoutResponse: true },
    getValue: () => _labRWValue,
    onWrite: (buffer) => {
        _labRWValue = new DataView(
            buffer instanceof ArrayBuffer ? buffer : buffer.buffer
        );
    },
});

// READ + NOTIFY characteristic — sends an incrementing counter
const labNotifyChar = new MockCharacteristic({
    uuid: '0000ff02-0000-1000-8000-00805f9b34fb',
    properties: { read: true, notify: true },
    getValue: () => numberToDataView(_labCounter, 1),
    getNotifyValue: () => numberToDataView(++_labCounter % 256, 1),
    notifyMs: 1000, // push every second
});

const labService = new MockService(
    '0000ffff-0000-1000-8000-00805f9b34fb',
    [labRWChar, labNotifyChar]
);

/* ── Virtual device ──────────────────────────────────────── */
function createVirtualDevice() {
    const server = new MockGATTServer(null, [batteryService, envService, labService]);
    const device = {
        id: 'virtual-device-00:11:22:33:44:55',
        name: 'Virtual BLE Device',
        gatt: server,
        _listeners: {},
        addEventListener(ev, cb) {
            if (!this._listeners[ev]) this._listeners[ev] = [];
            this._listeners[ev].push(cb);
        },
        removeEventListener(ev, cb) {
            if (!this._listeners[ev]) return;
            this._listeners[ev] = this._listeners[ev].filter(x => x !== cb);
        },
    };
    server.device = device;
    // reset counters each time a fresh device is created
    _batteryLevel = 87;
    _tempRaw = 2150;
    _labCounter = 0;
    _labRWValue = stringToDataView('hello');
    return device;
}

/* ============================================================
   MOCK BLUETOOTH
   Drop-in replacement for navigator.bluetooth.
   Only requestDevice() is needed — everything else flows through
   the device / server / service / characteristic objects above.
   ============================================================ */
const MockBluetooth = {
    /**
     * Simulates the browser device picker.
     * After a short pause it "selects" the virtual device
     * automatically — no UI dialog needed.
     */
    async requestDevice(/* options */) {
        await _delay(800); // simulate picker appearing and user selecting
        return createVirtualDevice();
    },
};

/* ============================================================
   HELPER – artificial delay (simulates BLE radio latency)
   ============================================================ */
function _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   PUBLIC API
   Called by app.js when the simulation toggle is switched.
   ============================================================ */

/**
 * Returns the MockBluetooth object.
 * app.js uses this instead of navigator.bluetooth when sim is on.
 */
function getMockBluetooth() {
    return MockBluetooth;
}

/**
 * Metadata about the virtual device for display in the UI.
 */
const VIRTUAL_DEVICE_INFO = {
    name: 'Virtual BLE Device',
    services: [
        { name: 'Battery Service', uuid: '0x180F', chars: ['battery_level — READ + NOTIFY'] },
        { name: 'Environmental Sensing', uuid: '0x181A', chars: ['temperature — READ + NOTIFY'] },
        { name: 'Lab Custom Service', uuid: '0xFFFF', chars: ['lab_rw — READ + WRITE', 'lab_counter — READ + NOTIFY'] },
    ],
};
