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
 * Deduplicate and categorize connected devices and emulators for Mirror selection.
 * Rules:
 * 1. Physical iPhone deduplication: If multiple entries exist for the same iPhone,
 *    collapse into a single entry. If any entry is via USB, treat as USB ('Siap').
 * 2. Android emulator running: 'Siap'.
 * 3. Android physical: 'Siap' if USB, 'Hanya Run' if Wi-Fi.
 * 4. iOS Simulator: 'Siap' if booted, 'Belum boot' if shutdown.
 * 5. Physical iPhone: 'Siap' if USB, 'Perlu kabel USB' if Wi-Fi.
 */
export function dedupeAndCategorizeDevices(
  devices: Device[] = [],
  emulators: Array<{ id: string; name: string; running?: boolean }> = []
): MirrorDeviceCard[] {
  const result: MirrorDeviceCard[] = [];
  const seenIphone = new Set<string>();

  // 1. Group / dedupe physical iPhones
  const iphoneEntries = devices.filter((d) => {
    const name = (d.name || '').toLowerCase();
    const id = (d.id || '').toLowerCase();
    const isSim = d.kind === 'emulator' || name.includes('simulator') || id.includes('simulator');
    return d.platform === 'ios' && !isSim && (d.kind === 'physical' || name.includes('iphone') || id.includes('iphone'));
  });

  if (iphoneEntries.length > 0) {
    // If multiple entries for the same physical iPhone, merge into one
    const hasUsb = iphoneEntries.some((d) => d.transport === 'usb' || d.id.includes('usb') || !d.id.includes('.'));
    const primary = iphoneEntries[0];
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

    for (const d of iphoneEntries) {
      seenIphone.add(d.id);
    }
  }

  // 2. Process other devices
  for (const d of devices) {
    if (seenIphone.has(d.id)) continue;

    const lowerName = (d.name || '').toLowerCase();
    const lowerId = (d.id || '').toLowerCase();

    if (d.platform === 'ios') {
      const isSim = d.kind === 'emulator' || lowerName.includes('simulator') || lowerId.includes('simulator');
      const isBooted = d.state === 'online' || (d.state as string) === 'booted';
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
      const isEmu = d.kind === 'emulator' || lowerId.startsWith('emulator-');
      if (isEmu) {
        const isRunning = d.state === 'online';
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
        const isUsb = d.transport === 'usb' || !d.id.includes(':');
        const isOnline = d.state === 'online';
        result.push({
          id: d.id,
          name: d.name,
          category: 'android-usb',
          statusText: isUsb && isOnline ? 'Siap' : isUsb ? 'Perlu kabel USB' : 'Hanya Run',
          canMirror: isUsb && isOnline,
          disabledReason: !isUsb
            ? 'Koneksi Wi-Fi hanya untuk Run/Debug, butuh USB untuk mirror'
            : !isOnline
            ? 'Perangkat tidak online / otorisasi USB debugging'
            : undefined,
          transportBadge: isUsb ? 'USB' : 'Wi-Fi',
          isUsb,
          platform: 'android',
        });
      }
    }
  }

  return result;
}
