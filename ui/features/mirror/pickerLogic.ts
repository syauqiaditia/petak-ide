import type { Device, DevicePlatform, DeviceKind } from '../../lib/api';

export interface MirrorDeviceCard {
  id: string;
  name: string;
  category: 'android-emulator' | 'android-usb' | 'ios-simulator' | 'iphone-usb' | 'other';
  statusText: 'Siap' | 'Perlu kabel USB' | 'Belum boot' | 'Hanya Run';
  canMirror: boolean;
  disabledReason?: string;
  transportBadge: 'USB' | 'Wi-Fi' | 'Emulator';
  isUsb: boolean;
  platform: DevicePlatform;
}

/**
 * Check whether a device represents an iOS simulator (B14).
 * Checks kind, group, sdk, name, id, and UUID v4 (36-char) while excluding physical UDID (00008...).
 */
export function isIosSimulatorDevice(d: Device | { [key: string]: any }): boolean {
  if (!d) return false;
  if (d.platform && d.platform !== 'ios') return false;

  const kind = ((d as any).kind || '').toLowerCase();
  if (
    kind === 'simulator' ||
    kind === 'ios-simulator' ||
    kind === 'ios-sim' ||
    kind === 'emulator'
  ) {
    return true;
  }

  const group = ((d as any).group || '').toLowerCase();
  if (group === 'simulator') {
    return true;
  }

  const sdk = ((d as any).sdk || '').toLowerCase();
  if (sdk.includes('coresimulator') || sdk.includes('simruntime')) {
    return true;
  }

  const name = ((d as any).name || '').toLowerCase();
  if (name.includes('simulator') || name.includes('ios simulator')) {
    return true;
  }

  const id = ((d as any).id || '').toLowerCase();
  if (id.includes('simulator')) {
    return true;
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    (d as any).id || ''
  );
  if (isUuid && !id.startsWith('00008')) {
    return true;
  }

  return false;
}

/**
 * Deduplicate and categorize connected devices and emulators for Mirror selection.
 * Rules:
 * 1. Physical iPhone deduplication: If multiple entries exist for the same iPhone,
 *    collapse into a single entry. If any entry is via USB, treat as USB ('Siap').
 * 2. Android emulator running: 'Siap'.
 * 3. Android physical: 'Siap' if online (USB or Wi-Fi).
 * 4. iOS Simulator: 'Siap' if booted, 'Belum boot' if shutdown.
 * 5. Physical iPhone: 'Siap' if USB, 'Perlu kabel USB' if Wi-Fi.
 */
export function dedupeAndCategorizeDevices(
  devices: Device[] = [],
  emulators: Array<{ id: string; name: string; running?: boolean; deviceId?: string | null }> = []
): MirrorDeviceCard[] {
  const result: MirrorDeviceCard[] = [];
  const seenIphone = new Set<string>();

  // 1. Group / dedupe physical iPhones
  const physicalIphones = devices.filter((d) => d.platform === 'ios' && !isIosSimulatorDevice(d));

  const iphoneGroups: Device[][] = [];
  for (const d of physicalIphones) {
    const cleanName = (d.name || '').replace(/\s*\((Wi-Fi|USB)\)/gi, '').trim().toLowerCase();
    const cleanId = (d.id || '').split('.')[0].split(':')[0].toLowerCase();

    const group = iphoneGroups.find((g) =>
      g.some((existing) => {
        const existingCleanId = (existing.id || '').split('.')[0].split(':')[0].toLowerCase();
        if (cleanId && existingCleanId && cleanId === existingCleanId) return true;
        const existingCleanName = (existing.name || '').replace(/\s*\((Wi-Fi|USB)\)/gi, '').trim().toLowerCase();
        if (cleanName && existingCleanName && cleanName === existingCleanName) return true;
        return false;
      })
    );

    if (group) {
      group.push(d);
    } else {
      iphoneGroups.push([d]);
    }
  }

  for (const group of iphoneGroups) {
    const isUsbEntry = (d: Device) => {
      if (d.transport === 'usb') return true;
      if (d.transport === 'wifi') return false;
      const lowerId = (d.id || '').toLowerCase();
      if (lowerId.includes('usb')) return true;
      if (lowerId.includes('.') || lowerId.includes(':')) return false;
      return true;
    };

    const hasUsb = group.some(isUsbEntry);
    const primary = group.find(isUsbEntry) || group[0];
    const name = primary.name.replace(/\s*\((Wi-Fi|USB)\)/gi, '').trim() || 'iPhone';

    result.push({
      id: primary.id,
      name,
      category: 'iphone-usb',
      statusText: hasUsb ? 'Siap' : 'Perlu kabel USB',
      canMirror: hasUsb,
      disabledReason: hasUsb ? undefined : 'Sambungkan kabel USB ke Mac (Wi-Fi hanya untuk Run)',
      transportBadge: hasUsb ? 'USB' : 'Wi-Fi',
      isUsb: hasUsb,
      platform: 'ios',
    });

    for (const d of group) {
      seenIphone.add(d.id);
    }
  }

  // 2. Process other devices
  for (const d of devices) {
    if (seenIphone.has(d.id)) continue;

    const lowerName = (d.name || '').toLowerCase();
    const lowerId = (d.id || '').toLowerCase();

    if (d.platform === 'ios') {
      const isBooted = d.state === 'online' || (d.state as string) === 'booted' || !d.state;
      result.push({
        id: d.id,
        name: d.name,
        category: 'ios-simulator',
        statusText: isBooted ? 'Siap' : 'Belum boot',
        canMirror: isBooted,
        disabledReason: isBooted ? undefined : 'Simulator belum di-boot. Nyalakan dari panel Devices',
        transportBadge: 'Emulator',
        isUsb: false,
        platform: 'ios',
      });
    } else if (d.platform === 'android') {
      const matchingEmu = emulators.find(
        (e) => e.id === d.id || e.name === d.name || (e.deviceId && e.deviceId === d.id)
      );
      const isEmu =
        d.kind === 'emulator' ||
        lowerId.startsWith('emulator-') ||
        (d.kind !== 'physical' && !d.transport && !d.id.includes(':') && (lowerId.includes('pixel') || lowerName.includes('pixel') || lowerName.includes('avd'))) ||
        Boolean(matchingEmu);

      if (isEmu) {
        const isRunning =
          d.state === 'online' ||
          Boolean(matchingEmu && (matchingEmu.running || (matchingEmu as any).state === 'running' || (matchingEmu as any).state === 'online'));
        result.push({
          id: d.id,
          name: d.name,
          category: 'android-emulator',
          statusText: isRunning ? 'Siap' : 'Belum boot',
          canMirror: isRunning,
          disabledReason: isRunning ? undefined : 'Emulator belum aktif',
          transportBadge: 'Emulator',
          isUsb: false,
          platform: 'android',
        });
      } else {
        const isWifi = d.transport === 'wifi' || (d.transport !== 'usb' && (d.id.includes(':') || d.id.includes('._adb') || d.id.includes('tls') || d.id.includes('tcp')));
        const isUsb = d.transport === 'usb' || !isWifi;
        const isOnline = d.state === 'online';
        result.push({
          id: d.id,
          name: d.name,
          category: 'android-usb',
          statusText: isOnline ? 'Siap' : isUsb ? 'Perlu kabel USB' : 'Hanya Run',
          canMirror: isOnline,
          disabledReason: isOnline
            ? undefined
            : 'Perangkat tidak online / otorisasi USB debugging',
          transportBadge: isUsb ? 'USB' : 'Wi-Fi',
          isUsb,
          platform: 'android',
        });
      }
    }
  }

  // 3. Process running emulators from emulators list not already in result
  if (emulators && emulators.length > 0) {
    for (const emu of emulators) {
      const isRunning = Boolean(emu.running || (emu as any).state === 'running' || (emu as any).state === 'online');
      if (!isRunning) continue;

      const alreadyAdded = result.some(
        (card) =>
          card.id === emu.id ||
          (emu.deviceId && card.id === emu.deviceId) ||
          card.name.toLowerCase() === (emu.name || '').toLowerCase()
      );

      if (!alreadyAdded) {
        result.push({
          id: emu.deviceId || emu.id,
          name: emu.name || emu.id,
          category: 'android-emulator',
          statusText: 'Siap',
          canMirror: true,
          disabledReason: undefined,
          transportBadge: 'Emulator',
          isUsb: false,
          platform: 'android',
        });
      }
    }
  }

  return result;
}
