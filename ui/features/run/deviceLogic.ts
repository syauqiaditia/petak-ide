/**
 * Pure logic for device categorization, grouping, picker filtering, and selection pruning (B2).
 */

import type { Device, Avd, DevicePlatform } from '../../lib/api';

export interface SnapshotEmulator {
  id: string;
  name: string;
  kind: 'android-avd' | 'ios-sim';
  state: 'running' | 'stopped' | 'booting';
  deviceId?: string | null;
  sdk?: string;
  flutterId?: string | null;
}

export type DeviceConnection = 'connected' | 'paired' | 'offline' | 'unavailable';
export type DeviceTransport = 'usb' | 'wifi' | 'unknown';

export interface SnapshotPhysical {
  id: string;
  name: string;
  platform: DevicePlatform;
  transport: DeviceTransport | 'wired' | string;
  connection?: DeviceConnection;
  connState?: string;
  tunnelState?: string | null;
  pairingState?: string | null;
  state?: string;
  sdk?: string;
  flutterId?: string | null;
}

export interface SnapshotOther {
  id: string;
  name: string;
  group: 'desktop' | 'web';
  state: 'online' | 'offline';
  connection?: DeviceConnection;
  flutterId?: string | null;
}

export interface DevicesSnapshot {
  emulators: SnapshotEmulator[];
  physical: SnapshotPhysical[];
  others?: SnapshotOther[];
}

export interface PickerDeviceItem {
  id: string;
  name: string;
  group: 'Emulator' | 'Simulator' | 'Physical' | 'Desktop' | 'Web';
  state: 'online' | 'booting' | 'running' | 'offline';
  connection: DeviceConnection;
  connState?: string;
  tunnelState?: string | null;
  pairingState?: string | null;
  transport?: DeviceTransport | 'wired' | string;
  platform: DevicePlatform;
  flutterId?: string | null;
  sdk?: string;
  runnable?: boolean;
}

export function getDeviceStatusLabel(item: {
  connState?: string;
  connection?: string;
  transport?: string | null;
}): string {
  const isWired = item.transport === 'wired';
  const isWifi = item.transport === 'wifi';

  if (item.connState === 'locked') {
    return 'Terkunci/Perlu dibuka';
  }

  if (item.connState === 'connected_usb') {
    return isWired ? 'Terhubung (USB)' : 'Terhubung';
  }

  if (item.connState === 'connected_wifi' || (item.connection === 'connected' && isWifi)) {
    return 'Terhubung (Wi-Fi)';
  }

  if (item.connection === 'connected') {
    return isWired ? 'Terhubung (USB)' : 'Terhubung';
  }

  if (item.connState === 'disconnected' || item.connection === 'paired' || item.connection === 'offline') {
    return 'Tidak terhubung';
  }

  return 'Tidak terhubung';
}

export function getDeviceTooltip(item: {
  tunnelState?: string | null;
  pairingState?: string | null;
}): string {
  const tunnel = item.tunnelState ?? 'None';
  const pairing = item.pairingState ?? 'None';
  return `tunnelState: ${tunnel} · pairingState: ${pairing}`;
}

export interface GroupedDevices {
  androidEmulators: SnapshotEmulator[];
  iosSimulators: SnapshotEmulator[];
  physicalDevices: SnapshotPhysical[];
  desktopDevices: SnapshotOther[];
  webDevices: SnapshotOther[];
  pickerItems: PickerDeviceItem[];
}

/**
 * Prune device selection (B2):
 * Any device that is offline, stopped, missing from snapshot, or has flutterId === null
 * is automatically pruned. If an online device exists, select it; otherwise leave empty (no device).
 */
export function pruneDeviceSelection(
  currentSelectedId: string | null | undefined,
  availableDevices: Array<{
    id: string;
    state?: string;
    connection?: DeviceConnection;
    runnable?: boolean;
    flutterId?: string | null;
  }>
): string {
  const isEligible = (d: { state?: string; connection?: DeviceConnection; runnable?: boolean; flutterId?: string | null }) => {
    const isOnline = d.state === 'online' || d.state === 'running';
    const isConnected = d.connection === undefined || d.connection === 'connected';
    const isRunnable = d.runnable !== false;
    const hasFlutter = d.flutterId !== null;
    return isOnline && isConnected && isRunnable && hasFlutter;
  };

  if (!currentSelectedId) {
    const firstOnline = availableDevices.find(isEligible);
    return firstOnline ? firstOnline.id : '';
  }

  const current = availableDevices.find((d) => d.id === currentSelectedId);
  if (current && isEligible(current)) {
    return current.id;
  }

  // Current is missing or offline or invalid -> prune!
  const firstOnline = availableDevices.find(isEligible);
  return firstOnline ? firstOnline.id : '';
}

/**
 * Categorize devices into Android Emulators, iOS Simulators, Physical Devices, Desktop, and Web.
 * Filters out offline devices from the title bar picker list.
 */
export function groupDevices(
  snapshot?: DevicesSnapshot | null,
  legacyDevices: Device[] = [],
  legacyAvds: Avd[] = []
): GroupedDevices {
  const androidEmulators: SnapshotEmulator[] = [];
  const iosSimulators: SnapshotEmulator[] = [];
  const physicalDevices: SnapshotPhysical[] = [];
  const desktopDevices: SnapshotOther[] = [];
  const webDevices: SnapshotOther[] = [];

  if (snapshot && (snapshot.emulators?.length > 0 || snapshot.physical?.length > 0 || (snapshot.others && snapshot.others.length > 0))) {
    for (const emu of snapshot.emulators || []) {
      if (emu.kind === 'android-avd') {
        androidEmulators.push(emu);
      } else if (emu.kind === 'ios-sim') {
        iosSimulators.push(emu);
      }
    }

    for (const phys of snapshot.physical || []) {
      physicalDevices.push(phys);
    }

    for (const other of snapshot.others || []) {
      if (other.group === 'desktop') {
        desktopDevices.push(other);
      } else if (other.group === 'web') {
        webDevices.push(other);
      }
    }
  } else {
    // Fallback parsing from legacy devices & avds
    for (const dev of legacyDevices) {
      if (dev.kind === 'physical' || (dev as any).kind === 'ios-physical') {
        const isWifi = dev.id.includes(':') || dev.id.includes('wireless') || (dev as any).transport === 'wifi';
        const rawTransport = (dev as any).transport;
        const transport = rawTransport || (isWifi ? 'wifi' : 'wired');
        const connState = (dev as any).connState || ((dev as any).state === 'online' ? (transport === 'wired' ? 'connected_usb' : 'connected_wifi') : 'disconnected');
        const connection: DeviceConnection = (dev as any).connection || (connState === 'locked' ? 'paired' : dev.state === 'online' ? 'connected' : 'offline');
        physicalDevices.push({
          id: dev.id,
          name: dev.name,
          platform: dev.platform,
          transport,
          connection,
          connState,
          tunnelState: (dev as any).tunnelState ?? null,
          pairingState: (dev as any).pairingState ?? null,
          state: dev.state,
          sdk: dev.sdk ?? undefined,
          flutterId: dev.state === 'online' && connection === 'connected' ? dev.id : null,
        });
      } else if (dev.platform === 'ios') {
        iosSimulators.push({
          id: dev.id,
          name: dev.name,
          kind: 'ios-sim',
          state: dev.state === 'online' ? 'running' : 'stopped',
          deviceId: dev.id,
          sdk: dev.sdk ?? undefined,
          flutterId: dev.state === 'online' ? dev.id : null,
        });
      } else if (dev.platform === 'android') {
        androidEmulators.push({
          id: dev.id,
          name: dev.name,
          kind: 'android-avd',
          state: dev.state === 'online' ? 'running' : 'stopped',
          deviceId: dev.id,
          sdk: dev.sdk ?? undefined,
          flutterId: dev.state === 'online' ? dev.id : null,
        });
      } else if (dev.platform === 'desktop') {
        desktopDevices.push({
          id: dev.id,
          name: dev.name,
          group: 'desktop',
          state: dev.state === 'online' ? 'online' : 'offline',
          connection: dev.state === 'online' ? 'connected' : 'offline',
          flutterId: dev.state === 'online' ? dev.id : null,
        });
      } else if (dev.platform === 'web' || dev.id === 'chrome') {
        webDevices.push({
          id: dev.id,
          name: dev.name,
          group: 'web',
          state: dev.state === 'online' ? 'online' : 'offline',
          connection: dev.state === 'online' ? 'connected' : 'offline',
          flutterId: dev.state === 'online' ? dev.id : null,
        });
      }
    }

    // Include AVDs that might not be running yet
    for (const avd of legacyAvds) {
      const already = androidEmulators.some(
        (e) => e.name.toLowerCase() === avd.name.toLowerCase()
      );
      if (!already) {
        androidEmulators.push({
          id: avd.name,
          name: avd.name,
          kind: 'android-avd',
          state: 'stopped',
          deviceId: null,
          flutterId: null,
        });
      }
    }
  }

  // Build picker items (only ONLINE / RUNNING devices with non-null flutterId)
  const pickerItems: PickerDeviceItem[] = [];

  // 1. Android Emulators that are running
  for (const emu of androidEmulators) {
    if (emu.state === 'running' || emu.state === 'booting') {
      pickerItems.push({
        id: emu.deviceId || emu.id,
        name: emu.name,
        group: 'Emulator',
        state: emu.state === 'running' ? 'online' : 'booting',
        connection: 'connected',
        platform: 'android',
        flutterId: emu.flutterId ?? (emu.deviceId || emu.id),
        sdk: emu.sdk,
        runnable: true,
      });
    }
  }

  // 2. iOS Simulators that are running
  for (const sim of iosSimulators) {
    if (sim.state === 'running' || sim.state === 'booting') {
      pickerItems.push({
        id: sim.deviceId || sim.id,
        name: sim.name,
        group: 'Simulator',
        state: sim.state === 'running' ? 'online' : 'booting',
        connection: 'connected',
        platform: 'ios',
        flutterId: sim.flutterId ?? (sim.deviceId || sim.id),
        sdk: sim.sdk,
        runnable: true,
      });
    }
  }

  // 3. Physical devices:
  // - connected: online, runnable
  // - paired: disabled, "Paired • tidak terhubung"
  // - unavailable: hidden from pickerItems!
  for (const phys of physicalDevices) {
    const conn: DeviceConnection = phys.connection || (phys.state === 'offline' ? 'offline' : 'connected');
    if (conn === 'unavailable' || conn === 'offline') {
      // Hidden from dropdown!
      continue;
    }
    const isLocked = phys.connState === 'locked';
    if (conn === 'paired' || isLocked) {
      pickerItems.push({
        id: phys.id,
        name: phys.name,
        group: 'Physical',
        state: 'offline',
        connection: 'paired',
        connState: phys.connState,
        tunnelState: phys.tunnelState,
        pairingState: phys.pairingState,
        platform: phys.platform,
        flutterId: phys.flutterId ?? null,
        transport: phys.transport,
        sdk: phys.sdk,
        runnable: false,
      });
    } else if (conn === 'connected') {
      pickerItems.push({
        id: phys.id,
        name: phys.name,
        group: 'Physical',
        state: 'online',
        connection: 'connected',
        connState: phys.connState,
        tunnelState: phys.tunnelState,
        pairingState: phys.pairingState,
        platform: phys.platform,
        flutterId: phys.flutterId ?? phys.id,
        transport: phys.transport,
        sdk: phys.sdk,
        runnable: true,
      });
    }
  }

  // 4. Desktop devices (only online)
  for (const d of desktopDevices) {
    if (d.state === 'online' && d.flutterId !== null) {
      pickerItems.push({
        id: d.id,
        name: d.name,
        group: 'Desktop',
        state: 'online',
        connection: 'connected',
        platform: 'desktop',
        flutterId: d.flutterId ?? d.id,
        runnable: true,
      });
    }
  }

  // 5. Web devices (only online)
  for (const w of webDevices) {
    if (w.state === 'online' && w.flutterId !== null) {
      pickerItems.push({
        id: w.id,
        name: w.name,
        group: 'Web',
        state: 'online',
        connection: 'connected',
        platform: 'web',
        flutterId: w.flutterId ?? w.id,
        runnable: true,
      });
    }
  }

  return {
    androidEmulators,
    iosSimulators,
    physicalDevices,
    desktopDevices,
    webDevices,
    pickerItems,
  };
}

/**
 * Remove 'booting' status from emulatorStatuses for devices that are now online.
 */
export function clearBootingForOnline(
  emulatorStatuses: Record<string, { state: 'stopped' | 'booting' | 'running' | 'failed'; error?: string }>,
  devices: Device[]
): Record<string, { state: 'stopped' | 'booting' | 'running' | 'failed'; error?: string }> {
  if (!emulatorStatuses || Object.keys(emulatorStatuses).length === 0) {
    return emulatorStatuses || {};
  }
  const next = { ...emulatorStatuses };
  let changed = false;

  for (const d of devices) {
    if (d.state === 'online') {
      if (d.id && next[d.id]?.state === 'booting') {
        delete next[d.id];
        changed = true;
      }
      if (d.name && next[d.name]?.state === 'booting') {
        delete next[d.name];
        changed = true;
      }
      for (const [key, val] of Object.entries(next)) {
        if (val.state === 'booting' && (key === d.id || key === d.name)) {
          delete next[key];
          changed = true;
        }
      }
    }
  }

  return changed ? next : emulatorStatuses;
}
