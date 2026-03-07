/**
 * ============================================================
 *  BLE Lab Explorer — app.js
 *  Web Bluetooth API demonstration for university students.
 *
 *  KEY BLE / GATT CONCEPTS USED IN THIS FILE
 *  ------------------------------------------
 *  Device       – A physical BLE peripheral (sensor, gadget…).
 *  GATT Server  – The database of services living on the device.
 *                 "Generic Attribute Profile" defines how data
 *                 is structured and exchanged over BLE.
 *  Service      – A logical group of related data, identified
 *                 by a UUID (e.g., 0x180F = Battery Service).
 *  Characteristic – A single data point inside a service,
 *                 also identified by a UUID. It can support
 *                 one or more of the following properties:
 *
 *    READ   – The central (phone/laptop) asks the device for
 *             the current value.  Good for one-off queries.
 *    WRITE  – The central sends a value to the device.
 *             Used to configure or control the peripheral.
 *    NOTIFY – The device automatically pushes updates to the
 *             central every time its value changes.  Perfect
 *             for continuous data streams (temperature, HR…).
 * ============================================================
 */

'use strict';

/* ============================================================
   STATE
   Holds references that are shared across all button handlers.
   ============================================================ */
const state = {
    device: null,   // BluetoothDevice
    server: null,   // BluetoothRemoteGATTServer
    services: [],
    selectedService: null,
    characteristics: [],
    selectedChar: null,
    notifying: false,
    simMode: false,  // true = use MockBluetooth from peripheral.js
};

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const $ = id => document.getElementById(id);

const btnScan = $('btn-scan');
const btnConnect = $('btn-connect');
const btnServices = $('btn-services');
const btnChars = $('btn-chars');
const btnRead = $('btn-read');
const btnWrite = $('btn-write');
const btnSubscribe = $('btn-subscribe');
const btnUnsubscribe = $('btn-unsubscribe');
const btnClearLog = $('btn-clear-log');

const deviceInfo = $('device-info');
const deviceName = $('device-name');
const deviceId = $('device-id');

const servicesContainer = $('services-container');
const servicesList = $('services-list');

const charsContainer = $('chars-container');
const charsList = $('chars-list');

const writeInput = $('write-input');

const connectionBadge = $('connection-badge');
const logOutput = $('log-output');

const badgeRead = $('badge-read');
const badgeWrite = $('badge-write');
const badgeNotify = $('badge-notify');
const propertyBadges = $('property-badges');

const simToggle = $('sim-toggle');   // Simulation Mode checkbox
const simInfoPanel = $('sim-info');    // Virtual device info card

/* ============================================================
   SIMULATION MODE TOGGLE
   When enabled, getMockBluetooth() from peripheral.js is used
   instead of navigator.bluetooth so the full GATT flow works
   without any physical BLE hardware.
   ============================================================ */
simToggle.addEventListener('change', () => {
    state.simMode = simToggle.checked;
    simInfoPanel.classList.toggle('hidden', !state.simMode);

    if (state.simMode) {
        log('🧪 Simulation Mode <strong>ON</strong> — using built-in virtual peripheral.', 'warn');
        log('   Click <strong>Scan</strong> to connect to the Virtual BLE Device.', 'info');
    } else {
        log('📡 Simulation Mode <strong>OFF</strong> — using real Web Bluetooth.', 'info');
    }
});

/* ============================================================
   LOGGING UTILITY
   Appends coloured log entries to the Live Log Console.
   Types: 'info' | 'success' | 'error' | 'warn' | 'notify' | 'write'
   ============================================================ */
function log(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-entry--${type}`;

    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', { hour12: false });

    entry.innerHTML = `
    <span class="log-ts">${time}</span>
    <span class="log-msg">${message}</span>
  `;

    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight; // Auto-scroll to bottom
}

/* ============================================================
   HELPER – format a DataView as hex string
   DataView is the raw binary type returned by read/notify.
   ============================================================ */
function dataViewToHex(dataView) {
    const bytes = new Uint8Array(dataView.buffer);
    return Array.from(bytes)
        .map(b => '0x' + b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
}

/* ============================================================
   HELPER – try to decode DataView as UTF-8 string
   ============================================================ */
function dataViewToText(dataView) {
    try {
        return new TextDecoder('utf-8').decode(dataView);
    } catch {
        return null;
    }
}

/* ============================================================
   HELPER – update the badge in the header
   ============================================================ */
function setConnectionBadge(connected) {
    if (connected) {
        connectionBadge.textContent = 'Connected';
        connectionBadge.className = 'badge badge--connected';
    } else {
        connectionBadge.textContent = 'Disconnected';
        connectionBadge.className = 'badge badge--disconnected';
    }
}

/* ============================================================
   HELPER – show which properties the selected char supports
   ============================================================ */
function updatePropertyBadges(char) {
    propertyBadges.classList.remove('hidden');

    const p = char.properties;
    badgeRead.classList.toggle('active', p.read);
    badgeWrite.classList.toggle('active', p.write || p.writeWithoutResponse);
    badgeNotify.classList.toggle('active', p.notify || p.indicate);
}

/* ============================================================
   HELPER – enable / disable action buttons based on
   the selected characteristic's supported properties.
   ============================================================ */
function updateActionButtons(char) {
    const p = char.properties;
    btnRead.disabled = !p.read;
    btnWrite.disabled = !(p.write || p.writeWithoutResponse);
    btnSubscribe.disabled = !(p.notify || p.indicate);

    if (btnRead.disabled)
        log('ℹ️ READ not supported by this characteristic.', 'warn');
    if (btnWrite.disabled)
        log('ℹ️ WRITE not supported by this characteristic.', 'warn');
    if (btnSubscribe.disabled)
        log('ℹ️ NOTIFY / INDICATE not supported by this characteristic.', 'warn');
}

/* ============================================================
   STEP 1 – SCAN
   navigator.bluetooth.requestDevice() opens the browser's
   native BLE device picker.  The user selects one device
   from the list of nearby advertising peripherals.

   acceptAllDevices: true  → show every nearby BLE device.

   IMPORTANT – optionalServices:
   Chrome blocks access to any GATT service unless its UUID is
   declared here at scan time (even with acceptAllDevices: true).
   We pre-declare all standard Bluetooth SIG 16-bit services plus
   the nRF Connect / Nordic UART Service so students can explore
   any device without hitting "Origin is not allowed to access
   any service" errors.
   ============================================================ */

/*
 * Full list of standard Bluetooth SIG GATT service UUIDs.
 * Source: https://www.bluetooth.com/specifications/assigned-numbers/
 * Adding all of them here ensures Chrome grants access regardless
 * of which services the target device exposes.
 */
const STANDARD_SERVICES = [
    /*
     * Using numeric 16-bit hex UUIDs instead of string aliases —
     * Chrome's string-name dictionary is incomplete and varies by
     * version, but 0xXXXX short UUIDs are always accepted.
     * Source: https://www.bluetooth.com/specifications/assigned-numbers/
     */

    // ── Generic ───────────────────────────────────────────────
    0x1800, // Generic Access
    0x1801, // Generic Attribute

    // ── Standard GATT profiles ────────────────────────────────
    0x1802, // Immediate Alert
    0x1803, // Link Loss
    0x1804, // Tx Power
    0x1805, // Current Time
    0x1806, // Reference Time Update
    0x1807, // Next DST Change
    0x1808, // Glucose
    0x1809, // Health Thermometer
    0x180A, // Device Information
    0x180D, // Heart Rate
    0x180E, // Phone Alert Status
    0x180F, // Battery Service
    0x1810, // Blood Pressure
    0x1811, // Alert Notification
    0x1812, // Human Interface Device
    0x1813, // Scan Parameters
    0x1814, // Running Speed and Cadence
    0x1815, // Automation IO
    0x1816, // Cycling Speed and Cadence
    0x1818, // Cycling Power
    0x1819, // Location and Navigation
    0x181A, // Environmental Sensing
    0x181B, // Body Composition
    0x181C, // User Data
    0x181D, // Weight Scale
    0x181E, // Bond Management
    0x181F, // Continuous Glucose Monitoring
    0x1820, // Internet Protocol Support
    0x1821, // Indoor Positioning
    0x1822, // Pulse Oximeter
    0x1823, // HTTP Proxy
    0x1824, // Transport Discovery
    0x1825, // Object Transfer
    0x1826, // Fitness Machine
    0x1827, // Mesh Provisioning
    0x1828, // Mesh Proxy
    0x1829, // Reconnection Configuration
    0x183A, // Insulin Delivery
    0x183B, // Binary Sensor
    0x183C, // Emergency Configuration
    0x183E, // Physical Activity Monitor
    0x1843, // Audio Stream Control
    0x1844, // Broadcast Audio Scan
    0x1845, // Published Audio Capabilities
    0x1846, // Basic Audio Announcement
    0x1847, // Broadcast Audio Announcement

    // ── Nordic UART Service (NUS) — used in nRF Connect labs ──
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // NUS Service
    '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // NUS RX
    '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // NUS TX
];

btnScan.addEventListener('click', async () => {
    log('🔍 Opening browser BLE device picker…');

    try {
        /*
         * requestDevice() MUST be triggered by a user gesture (button click).
         *
         * Simulation mode: use MockBluetooth from peripheral.js — instantly
         * "selects" the virtual device without showing the browser picker.
         *
         * Real mode: use navigator.bluetooth with optionalServices declared
         * so Chrome grants access to GATT services after connection.
         */
        if (state.simMode) {
            state.device = await getMockBluetooth().requestDevice();
        } else {
            state.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: STANDARD_SERVICES,
            });
        }

        log(`✅ Device selected: <strong>${state.device.name || 'Unnamed device'}</strong>`, 'success');
        log(`   Device ID: ${state.device.id}`, 'info');

        // Update UI
        deviceName.textContent = state.device.name || 'Unnamed device';
        deviceId.textContent = state.device.id;
        deviceInfo.classList.remove('hidden');

        btnConnect.disabled = false;

        /*
         * Listen for the device disconnecting unexpectedly
         * (e.g. the user walks out of range).
         */
        state.device.addEventListener('gattserverdisconnected', () => {
            log('⚠️ Device disconnected unexpectedly.', 'warn');
            setConnectionBadge(false);
            resetPostDisconnect();
        });

    } catch (err) {
        // User cancelled the picker, or Bluetooth is unavailable.
        if (err.name === 'NotFoundError') {
            log('ℹ️ No device selected (picker closed).', 'warn');
        } else {
            log(`❌ Scan failed: ${err.message}`, 'error');
        }
    }
});

/* ============================================================
   STEP 2 – CONNECT
   device.gatt.connect() establishes an ACL (data) connection
   to the remote device and returns the GATT server object.
   This is where the "handshake" happens.
   ============================================================ */
btnConnect.addEventListener('click', async () => {
    if (!state.device) return;

    log(`🔗 Connecting to ${state.device.name || 'device'}…`);

    try {
        /*
         * gatt is the BluetoothRemoteGATTServer.
         * Calling .connect() opens the BLE link layer connection.
         * This may take 1–3 seconds depending on the device.
         */
        state.server = await state.device.gatt.connect();

        log('✅ Connected to GATT server!', 'success');
        log('   GATT server is the remote database of services.', 'info');

        setConnectionBadge(true);
        btnServices.disabled = false;

    } catch (err) {
        log(`❌ Connection failed: ${err.message}`, 'error');
    }
});

/* ============================================================
   STEP 3 – DISCOVER SERVICES
   getPrimaryServices() returns all top-level service objects
   exposed by this device's GATT server.
   Each service is identified by a UUID.

   Standard UUIDs (16-bit, assigned by Bluetooth SIG):
     0x180F = Battery Service
     0x180D = Heart Rate Service
     0x181A = Environmental Sensing Service

   Custom / vendor services use 128-bit UUIDs.
   ============================================================ */
btnServices.addEventListener('click', async () => {
    if (!state.server) return;

    log('📡 Discovering primary services…');

    try {
        state.services = await state.server.getPrimaryServices();

        if (state.services.length === 0) {
            log('⚠️ No services found on this device.', 'warn');
            return;
        }

        log(`✅ Found ${state.services.length} service(s).`, 'success');

        // Populate the services list
        servicesList.innerHTML = '';
        state.services.forEach((svc, index) => {
            const li = document.createElement('li');
            li.innerHTML = `
        <span>Service ${index + 1}</span>
        <span class="item-uuid">${svc.uuid}</span>
      `;
            li.title = 'Click to select this service';

            li.addEventListener('click', () => {
                // Highlight the selected service
                document.querySelectorAll('#services-list li').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');

                state.selectedService = svc;
                log(`🔵 Service selected: <code>${svc.uuid}</code>`, 'info');

                btnChars.disabled = false;

                // Reset chars panel when selecting a new service
                charsList.innerHTML = '';
                charsContainer.classList.add('hidden');
                state.selectedChar = null;
                resetCharButtons();
            });

            servicesList.appendChild(li);
            log(`   📋 ${svc.uuid}`, 'info');
        });

        servicesContainer.classList.remove('hidden');
        log('👉 Click a service above to select it, then click "Discover Characteristics".', 'info');

    } catch (err) {
        log(`❌ Service discovery failed: ${err.message}`, 'error');
    }
});

/* ============================================================
   STEP 4 – DISCOVER CHARACTERISTICS
   getCharacteristics() returns all characteristics within the
   selected service.

   Each characteristic shows its properties:
   • read   – value can be fetched by the central
   • write  – central can push a value to the device
   • notify – device pushes updates on its own schedule
   • indicate – like notify but with acknowledgement
   ============================================================ */
btnChars.addEventListener('click', async () => {
    if (!state.selectedService) {
        log('⚠️ Please select a service first.', 'warn');
        return;
    }

    log(`📋 Discovering characteristics in service <code>${state.selectedService.uuid}</code>…`);

    try {
        state.characteristics = await state.selectedService.getCharacteristics();

        if (state.characteristics.length === 0) {
            log('⚠️ No characteristics found in this service.', 'warn');
            return;
        }

        log(`✅ Found ${state.characteristics.length} characteristic(s).`, 'success');

        // Populate characteristics list
        charsList.innerHTML = '';
        state.characteristics.forEach((char, index) => {
            const props = Object.entries(char.properties)
                .filter(([, v]) => v === true)
                .map(([k]) => k.toUpperCase());

            const li = document.createElement('li');
            li.innerHTML = `
        <span>Characteristic ${index + 1}</span>
        <span class="item-uuid">${char.uuid}</span>
        <div class="item-props">
          ${props.map(p => `<span class="prop-badge prop-badge--${p.toLowerCase().includes('read') ? 'read' : p.toLowerCase().includes('write') ? 'write' : 'notify'} active" style="font-size:0.6rem;padding:1px 5px;">${p}</span>`).join('')}
        </div>
      `;
            li.title = 'Click to select this characteristic';

            li.addEventListener('click', () => {
                // Highlight and select
                document.querySelectorAll('#chars-list li').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');

                state.selectedChar = char;
                log(`🔵 Characteristic selected: <code>${char.uuid}</code>`, 'info');
                log(`   Properties: ${props.join(', ')}`, 'info');

                updatePropertyBadges(char);
                updateActionButtons(char);
            });

            charsList.appendChild(li);
            log(`   📌 ${char.uuid} [${props.join(', ')}]`, 'info');
        });

        charsContainer.classList.remove('hidden');
        log('👉 Click a characteristic above to select it.', 'info');

    } catch (err) {
        log(`❌ Characteristic discovery failed: ${err.message}`, 'error');
    }
});

/* ============================================================
   STEP 5a – READ
   readValue() asks the device for the CURRENT value of this
   characteristic.  This is a one-shot request; the result is
   returned as a DataView (raw binary buffer).

   We attempt to display it both as hex bytes and UTF-8 text.
   ============================================================ */
btnRead.addEventListener('click', async () => {
    if (!state.selectedChar) return;

    log(`📖 Reading characteristic <code>${state.selectedChar.uuid}</code>…`);

    try {
        /*
         * readValue() triggers an ATT Read Request on the BLE link.
         * The device responds with the raw bytes of the characteristic.
         */
        const dataView = await state.selectedChar.readValue();

        const hex = dataViewToHex(dataView);
        const text = dataViewToText(dataView);

        log(`✅ READ value (hex):  <code>${hex}</code>`, 'success');

        if (text && text.trim().length > 0) {
            log(`   READ value (text): <code>${text.trim()}</code>`, 'success');
        }

    } catch (err) {
        log(`❌ Read failed: ${err.message}`, 'error');
    }
});

/* ============================================================
   STEP 5b – WRITE
   writeValue() / writeValueWithResponse() sends a value FROM
   the central (browser) TO the device.

   Parse logic:
   • If the input contains tokens starting with "0x", interpret
     each as a hex byte → build a Uint8Array.
   • Otherwise encode the plain text string as UTF-8.
   ============================================================ */
btnWrite.addEventListener('click', async () => {
    if (!state.selectedChar) return;

    const raw = writeInput.value.trim();
    if (!raw) {
        log('⚠️ Please enter a value to write.', 'warn');
        return;
    }

    let buffer;

    if (/0x[0-9a-fA-F]+/.test(raw)) {
        // --- HEX MODE ---
        try {
            const tokens = raw.split(/\s+/);
            const bytes = tokens.map(t => parseInt(t, 16));
            if (bytes.some(isNaN)) throw new Error('Invalid hex token');
            buffer = new Uint8Array(bytes);
            log(`✏️ Writing hex bytes: <code>${raw}</code>`, 'write');
        } catch {
            log('❌ Invalid hex format.  Use e.g. <code>0x01 0xFF 0x2A</code>', 'error');
            return;
        }
    } else {
        // --- TEXT MODE ---
        buffer = new TextEncoder().encode(raw);
        log(`✏️ Writing text: <code>${raw}</code>`, 'write');
    }

    try {
        /*
         * writeValueWithResponse() sends an ATT Write Request.
         * The device must acknowledge receipt (more reliable).
         *
         * writeValueWithoutResponse() fires and forgets — faster
         * but no guarantee the device received it.
         */
        if (state.selectedChar.properties.write) {
            await state.selectedChar.writeValueWithResponse(buffer);
            log('✅ Write acknowledged by device.', 'success');
        } else {
            await state.selectedChar.writeValueWithoutResponse(buffer);
            log('✅ Write sent (without response).', 'success');
        }
    } catch (err) {
        log(`❌ Write failed: ${err.message}`, 'error');
    }
});

/* ============================================================
   STEP 5c – SUBSCRIBE TO NOTIFICATIONS
   startNotifications() tells the device to send ATT Handle
   Value Notifications whenever the characteristic's value
   changes.  The 'characteristicvaluechanged' event fires
   every time a new value arrives — no polling required!

   This is the most efficient way to receive continuous data
   (e.g. sensor readings, button press events).
   ============================================================ */
btnSubscribe.addEventListener('click', async () => {
    if (!state.selectedChar || state.notifying) return;

    log(`🔔 Subscribing to notifications on <code>${state.selectedChar.uuid}</code>…`);

    try {
        /*
         * startNotifications() writes to the Client Characteristic
         * Configuration Descriptor (CCCD) on the device, enabling
         * the Notify bit so the device starts sending updates.
         */
        await state.selectedChar.startNotifications();

        // Event fires every time the device pushes a new value
        state.selectedChar.addEventListener('characteristicvaluechanged', onNotification);

        state.notifying = true;
        log('✅ Subscribed! Waiting for notifications…', 'success');

        btnSubscribe.disabled = true;
        btnUnsubscribe.disabled = false;

    } catch (err) {
        log(`❌ Subscribe failed: ${err.message}`, 'error');
    }
});

/* ── Notification handler ──────────────────────────────────
   Called automatically every time the device sends new data.
   ─────────────────────────────────────────────────────── */
function onNotification(event) {
    /*
     * event.target is the characteristic.
     * event.target.value is a DataView with the new raw bytes.
     */
    const dataView = event.target.value;
    const hex = dataViewToHex(dataView);
    const text = dataViewToText(dataView);

    log(`🔔 Notification received → hex: <code>${hex}</code>`, 'notify');

    if (text && text.trim().length > 0) {
        log(`                          text: <code>${text.trim()}</code>`, 'notify');
    }
}

/* ============================================================
   UNSUBSCRIBE
   Writes to the CCCD again, clearing the Notify bit so the
   device stops sending unsolicited updates.
   ============================================================ */
btnUnsubscribe.addEventListener('click', async () => {
    if (!state.selectedChar || !state.notifying) return;

    log('🔕 Unsubscribing from notifications…');

    try {
        await state.selectedChar.stopNotifications();
        state.selectedChar.removeEventListener('characteristicvaluechanged', onNotification);

        state.notifying = false;
        log('✅ Unsubscribed.', 'success');

        btnSubscribe.disabled = false;
        btnUnsubscribe.disabled = true;

    } catch (err) {
        log(`❌ Unsubscribe failed: ${err.message}`, 'error');
    }
});

/* ============================================================
   CLEAR LOG
   ============================================================ */
btnClearLog.addEventListener('click', () => {
    logOutput.innerHTML = '';
    log('🗑️ Log cleared.', 'info');
});

/* ============================================================
   HELPERS – reset UI state after disconnect
   ============================================================ */
function resetCharButtons() {
    btnRead.disabled = true;
    btnWrite.disabled = true;
    btnSubscribe.disabled = true;
    btnUnsubscribe.disabled = true;
    propertyBadges.classList.add('hidden');
}

function resetPostDisconnect() {
    btnServices.disabled = true;
    btnChars.disabled = true;
    resetCharButtons();
    state.server = null;
    state.services = [];
    state.selectedService = null;
    state.characteristics = [];
    state.selectedChar = null;
    state.notifying = false;
}

/* ============================================================
   BROWSER SUPPORT CHECK
   Web Bluetooth is only available in secure contexts (HTTPS /
   localhost) on Chrome, Edge, and some Chromium browsers.
   Firefox and Safari do not support it as of 2024.
   ============================================================ */
if (!navigator.bluetooth) {
    log('❌ Web Bluetooth API is NOT available in this browser.', 'error');
    log('   Please use Google Chrome or Microsoft Edge on desktop / Android.', 'warn');
    btnScan.disabled = true;
} else {
    log('✅ Web Bluetooth API detected. You are ready to explore!', 'success');
}
