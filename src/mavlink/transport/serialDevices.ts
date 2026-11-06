// Choosing and re-finding the USB serial device behind a serial link.
//
// The browser pickers (navigator.serial.requestPort, navigator.usb.requestDevice) need a user gesture, so they run
// from the Connect button. Every later connect -- the automatic reconnect after a cable blip, or a page reload --
// re-finds the device among the ones this origin was already granted (getPorts/getDevices), which needs no gesture.
// A replugged device comes back as a new object, so it is matched by USB vendor/product id (and serial number for
// WebUSB), and remembered in localStorage so a reload picks the same device.

import { getWebSerialNavigator, type WebSerialPortInfo, type WebSerialPortLike } from './webSerialTransport';
import { ARDUPILOT_USB_VENDOR_ID, USB_CLASS_CDC, USB_CLASS_CDC_DATA } from './webUsbCdc';
import type { UsbSerialDeviceLike } from './webUsbSerialTransport';

/** Which browser API carries a serial link. */
export type SerialApi = 'web-serial' | 'web-usb-serial';

const STORAGE_KEY_SERIAL_PORT = 'mavlink_glareshield_serial_port';
const STORAGE_KEY_USB_DEVICE = 'mavlink_glareshield_usb_device';

interface UsbNavigatorLike {
  requestDevice(options: { filters: Array<Record<string, number>> }): Promise<UsbSerialDeviceLike & UsbDeviceIds>;
  getDevices(): Promise<Array<UsbSerialDeviceLike & UsbDeviceIds>>;
}

interface UsbDeviceIds {
  readonly vendorId?: number;
  readonly productId?: number;
  readonly serialNumber?: string;
}

function getUsbNavigator(): UsbNavigatorLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { usb?: UsbNavigatorLike }).usb;
}

export function isWebSerialSupported(): boolean {
  return getWebSerialNavigator() !== undefined;
}

export function isWebUsbSupported(): boolean {
  return getUsbNavigator() !== undefined;
}

/**
 * The API a serial link should use here, or null when this browser has neither.
 *
 * Web Serial wherever it exists (desktop Chrome/Edge): it reaches every kind of USB serial adapter. WebUSB only
 * where Web Serial is missing (Chrome on Android), because on desktop the OS driver already owns the CDC interface
 * and WebUSB cannot claim it.
 */
export function getSerialApi(): SerialApi | null {
  if (isWebSerialSupported()) return 'web-serial';
  if (isWebUsbSupported()) return 'web-usb-serial';
  return null;
}

function readStored<T>(key: string): T | undefined {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the device is still remembered for this page session.
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Web Serial
// ---------------------------------------------------------------------------------------------------------------

let selectedPort: WebSerialPortLike | undefined;

function portInfo(port: WebSerialPortLike): WebSerialPortInfo {
  try {
    return port.getInfo?.() ?? {};
  } catch {
    return {};
  }
}

function sameUsbIds(a: WebSerialPortInfo, b: WebSerialPortInfo | undefined): boolean {
  return (
    !!b && a.usbVendorId !== undefined && a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId
  );
}

/**
 * Show the browser's serial port picker. Call it directly from a click or submit handler, before any other await.
 * Returns undefined when the user dismisses the picker.
 */
export async function requestSerialPort(): Promise<WebSerialPortLike | undefined> {
  const serial = getWebSerialNavigator();
  if (!serial) return undefined;
  try {
    const port = await serial.requestPort();
    selectedPort = port;
    writeStored(STORAGE_KEY_SERIAL_PORT, portInfo(port));
    return port;
  } catch {
    return undefined;
  }
}

/** The chosen port if it is still present, else a granted port with the same USB ids, else the only granted port. */
export async function resolveSerialPort(): Promise<WebSerialPortLike | undefined> {
  const serial = getWebSerialNavigator();
  if (!serial?.getPorts) return selectedPort;
  let ports: WebSerialPortLike[];
  try {
    ports = await serial.getPorts();
  } catch {
    return selectedPort;
  }
  if (selectedPort && ports.includes(selectedPort)) return selectedPort;

  const wanted = selectedPort ? portInfo(selectedPort) : readStored<WebSerialPortInfo>(STORAGE_KEY_SERIAL_PORT);
  const match = wanted ? ports.find((port) => sameUsbIds(portInfo(port), wanted)) : undefined;
  const found = match ?? (ports.length === 1 ? ports[0] : undefined);
  if (found) selectedPort = found;
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// WebUSB (Android)
// ---------------------------------------------------------------------------------------------------------------

let selectedUsbDevice: (UsbSerialDeviceLike & UsbDeviceIds) | undefined;

function usbIds(device: UsbDeviceIds): UsbDeviceIds {
  return { vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber };
}

/**
 * Show the browser's USB device picker, listing ArduPilot boards and other CDC-ACM (USB virtual COM port) devices.
 * Call it directly from a click or submit handler. Returns undefined when the user dismisses the picker.
 */
export async function requestUsbSerialDevice(): Promise<UsbSerialDeviceLike | undefined> {
  const usb = getUsbNavigator();
  if (!usb) return undefined;
  try {
    const device = await usb.requestDevice({
      filters: [{ vendorId: ARDUPILOT_USB_VENDOR_ID }, { classCode: USB_CLASS_CDC }, { classCode: USB_CLASS_CDC_DATA }],
    });
    selectedUsbDevice = device;
    writeStored(STORAGE_KEY_USB_DEVICE, usbIds(device));
    return device;
  } catch {
    return undefined;
  }
}

export async function resolveUsbSerialDevice(): Promise<UsbSerialDeviceLike | undefined> {
  const usb = getUsbNavigator();
  if (!usb) return selectedUsbDevice;
  let devices: Array<UsbSerialDeviceLike & UsbDeviceIds>;
  try {
    devices = await usb.getDevices();
  } catch {
    return selectedUsbDevice;
  }
  if (selectedUsbDevice && devices.includes(selectedUsbDevice)) return selectedUsbDevice;

  const wanted = selectedUsbDevice ? usbIds(selectedUsbDevice) : readStored<UsbDeviceIds>(STORAGE_KEY_USB_DEVICE);
  const match = wanted
    ? devices.find(
        (device) =>
          device.vendorId === wanted.vendorId &&
          device.productId === wanted.productId &&
          (!wanted.serialNumber || device.serialNumber === wanted.serialNumber)
      )
    : undefined;
  const found = match ?? (devices.length === 1 ? devices[0] : undefined);
  if (found) selectedUsbDevice = found;
  return found;
}

/** Show the picker for whichever API this browser uses. Resolves false when the user dismissed it. */
export async function requestSerialDevice(): Promise<boolean> {
  const api = getSerialApi();
  if (api === 'web-serial') return (await requestSerialPort()) !== undefined;
  if (api === 'web-usb-serial') return (await requestUsbSerialDevice()) !== undefined;
  return false;
}

/** Forget the in-memory selection (tests; or after the user revokes access). */
export function resetSerialSelection(): void {
  selectedPort = undefined;
  selectedUsbDevice = undefined;
}
