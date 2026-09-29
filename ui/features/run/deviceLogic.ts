/**
 * Pure logic for device categorization, grouping, and picker filtering.
 */

import type { Device, Avd, DevicePlatform } from '../../lib/api';

export interface SnapshotEmulator {
  id: string;
  name: string;
  kind: 'android-avd' | 'ios-sim';
  state: 'running' | 'stopped' | 'booting';
  deviceId?: string | null;
  sdk?: string;
}

export interface SnapshotPhysical {
  id: string;
  name: string;
  platform: DevicePlatform;
  transport: 'usb' | 'wifi';
  state?: string;
  sdk?: string;
}

export interface DevicesSnapshot {
  emulators: SnapshotEmulator[];
  physical: SnapshotPhysical[];
}

export interface PickerDeviceItem {
  id: string;
  name: string;
  group: 'Emulator' | 'Simulator' | 'Physical';
  state: 'online' | 'booting' | 'running';
  platform: DevicePlatform;
  sdk?: string;
}

export interface GroupedDevices {
  androidEmulators: SnapshotEmulator[];
  iosSimulators: SnapshotEmulator[];
  physicalDevices: SnapshotPhysical[];
  pickerItems: PickerDeviceItem[];
}

/**
 * Categorize devices into Android Emulators, iOS Simulators, and Physical Devices.
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

  if (snapshot && (snapshot.emulators?.length > 0 || snapshot.physical?.length > 0)) {
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
  } else {
    // Fallback parsing from legacy devices & avds
    for (const dev of legacyDevices) {
      if (dev.kind === 'physical') {
        physicalDevices.push({
          id: dev.id,
          name: dev.name,
          platform: dev.platform,
          transport: dev.id.includes(':') ? 'wifi' : 'usb',
          state: dev.state,
          sdk: dev.sdk ?? undefined,
        });
      } else if (dev.platform === 'ios') {
        iosSimulators.push({
          id: dev.id,
          name: dev.name,
          kind: 'ios-sim',
          state: dev.state === 'online' ? 'running' : 'stopped',
          deviceId: dev.id,
          sdk: dev.sdk ?? undefined,
        });
      } else {
        androidEmulators.push({
          id: dev.id,
          name: dev.name,
          kind: 'android-avd',
          state: dev.state === 'online' ? 'running' : 'stopped',
          deviceId: dev.id,
          sdk: dev.sdk ?? undefined,
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
        });
      }
    }
  }

  // Build picker items (only ONLINE / RUNNING devices, grouped)
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
        sdk: sim.sdk,
      });
    }
  }

  // 3. Physical devices (only online / not offline)
  for (const phys of physicalDevices) {
    if (phys.state !== 'offline') {
      pickerItems.push({
        id: phys.id,
        name: phys.name,
        group: 'Physical',
        state: 'online',
        platform: phys.platform,
        sdk: phys.sdk,
      });
    }
  }

  return {
    androidEmulators,
    iosSimulators,
    physicalDevices,
    pickerItems,
  };
}
