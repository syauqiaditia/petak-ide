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

export interface SnapshotPhysical {
  id: string;
  name: string;
  platform: DevicePlatform;
  transport: 'usb' | 'wifi';
  state?: string;
  sdk?: string;
  flutterId?: string | null;
}

export interface SnapshotOther {
  id: string;
  name: string;
  group: 'desktop' | 'web';
  state: 'online' | 'offline';
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
  state: 'online' | 'booting' | 'running';
  platform: DevicePlatform;
  flutterId?: string | null;
  transport?: 'usb' | 'wifi';
  sdk?: string;
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
    flutterId?: string | null;
  }>
): string {
  if (!currentSelectedId) {
    const firstOnline = availableDevices.find(
      (d) => (d.state === 'online' || d.state === 'running') && d.flutterId !== null
    );
    return firstOnline ? firstOnline.id : '';
  }

  const current = availableDevices.find((d) => d.id === currentSelectedId);
  const isOnline = current && (current.state === 'online' || current.state === 'running');
  const isValidFlutter = current && current.flutterId !== null;

  if (current && isOnline && isValidFlutter) {
    return current.id;
  }

  // Current is missing or offline or invalid -> prune!
  const firstOnline = availableDevices.find(
    (d) => (d.state === 'online' || d.state === 'running') && d.flutterId !== null
  );
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
        physicalDevices.push({
          id: dev.id,
          name: dev.name,
          platform: dev.platform,
          transport: isWifi ? 'wifi' : 'usb',
          state: dev.state,
          sdk: dev.sdk ?? undefined,
          flutterId: dev.state === 'online' ? dev.id : null,
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
          flutterId: dev.state === 'online' ? dev.id : null,
        });
      } else if (dev.platform === 'web' || dev.id === 'chrome') {
        webDevices.push({
          id: dev.id,
          name: dev.name,
          group: 'web',
          state: dev.state === 'online' ? 'online' : 'offline',
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
        platform: 'android',
        flutterId: emu.flutterId ?? (emu.deviceId || emu.id),
        sdk: emu.sdk,
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
        platform: 'ios',
        flutterId: sim.flutterId ?? (sim.deviceId || sim.id),
        sdk: sim.sdk,
      });
    }
  }

  // 3. Physical devices (only online / not offline, and flutterId != null)
  for (const phys of physicalDevices) {
    if (phys.state !== 'offline' && phys.flutterId !== null) {
      pickerItems.push({
        id: phys.id,
        name: phys.name,
        group: 'Physical',
        state: 'online',
        platform: phys.platform,
        flutterId: phys.flutterId ?? phys.id,
        transport: phys.transport,
        sdk: phys.sdk,
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
        platform: 'desktop',
        flutterId: d.flutterId ?? d.id,
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
        platform: 'web',
        flutterId: w.flutterId ?? w.id,
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
