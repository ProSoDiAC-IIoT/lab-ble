# 📡 BLE Lab Explorer

An interactive web application for exploring **Bluetooth Low Energy (BLE)** using the **Web Bluetooth API**, developed for the Computer Science university laboratory.

---

## 🎯 Lab Objectives

By the end of this lab you will be able to:

- Scan for nearby BLE devices
- Connect to a device's GATT server
- Discover primary **services** and **characteristics**
- **Read** characteristic values
- **Write** values to a characteristic
- **Subscribe to notifications** and receive live data

---

## 🌐 Browser Requirement

> ⚠️ This app works **only in Google Chrome or Microsoft Edge** (desktop or Android).  
> Firefox and Safari do **not** support the Web Bluetooth API.

Make sure Bluetooth is enabled on your computer before starting.

---

## 📖 How to Use the App

Click the **"📖 Step-by-Step Guide"** button in the top-right corner of the app for the full tutorial.

The app walks you through 5 steps in order:

| Step | What you do |
|---|---|
| **1 — Device** | Click **Scan** → pick your BLE device from the browser picker |
| **2 — GATT Server** | Click **Connect** → open the BLE link to the device |
| **3 — Services** | Click **Discover Services** → select a service from the list |
| **4 — Characteristics** | Click **Discover Characteristics** → select a characteristic |
| **5 — Operations** | Use **Read**, **Write**, or **Subscribe** depending on what the characteristic supports |

All operations and their results are shown in real time in the **Live Log Console** on the right.

---

## 🔵 Key BLE / GATT Concepts

| Term | Definition |
|---|---|
| **Device** | A BLE peripheral (sensor, gadget) that advertises itself wirelessly |
| **GATT Server** | The remote database of services running on the peripheral |
| **Service** | A logical group of related data, identified by a UUID |
| **Characteristic** | A single data value within a service |
| **READ** | One-shot fetch of the characteristic's current value |
| **WRITE** | Send data from the browser to the device |
| **NOTIFY** | The device pushes updates automatically whenever the value changes |
| **UUID** | Unique identifier for a service or characteristic (16-bit standard, 128-bit custom) |

---

## 🛠️ Write Format Reference

When writing a value to a characteristic, the input field accepts:

| Format | Example | Notes |
|---|---|---|
| Plain text (UTF-8) | `hello` | Sent as UTF-8 encoded bytes |
| Hex bytes | `0x01 0xFF 0x2A` | Each token is one byte, prefixed with `0x` |

