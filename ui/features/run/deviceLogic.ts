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
  transport: DeviceTransport;
  connection?: DeviceConnection;
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
  transport?: DeviceTransport;
  platform: DevicePlatform;
  flutterId?: string | null;
  sdk?: string;
  runnable?: boolean;
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
      if (dev.kind === 'physical') {
        const isWifi = dev.id.includes(':') || dev.id.includes('wireless') || (dev as any).transport === 'wifi';
        const transport: DeviceTransport = (dev as any).transport || (isWifi ? 'wifi' : 'usb');
        const connection: DeviceConnection = (dev as any).connection || (dev.state === 'online' ? 'connected' : 'offline');
        physicalDevices.push({
          id: dev.id,
          name: dev.name,
          platform: dev.platform,
          transport,
          connection,
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
    if (conn === 'paired') {
      pickerItems.push({
        id: phys.id,
        name: phys.name,
        group: 'Physical',
        state: 'offline',
        connection: 'paired',
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
