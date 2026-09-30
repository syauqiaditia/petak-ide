/**
 * Pure logic for device mirror platform classification, honest messaging, and error sanitation (B3).
 */

export interface DeviceClassification {
  platform: 'android' | 'ios';
  kind: 'android' | 'ios-physical' | 'ios-simulator';
  isPhysical: boolean;
}

export function classifyMirrorDevice(
  device?: { platform?: string; kind?: string; id?: string; name?: string } | null,
  serial?: string
): DeviceClassification {
  const devId = (device?.id || serial || '').toLowerCase();
  const devName = (device?.name || '').toLowerCase();
  const rawKind = (device?.kind || '').toLowerCase();
  const rawPlatform = (device?.platform || '').toLowerCase();

  const isIos =
    rawPlatform === 'ios' ||
    rawKind.includes('ios') ||
    devId.includes('iphone') ||
    devName.includes('iphone') ||
    devId.includes('ipad') ||
    devName.includes('ipad');

  if (isIos) {
    const isSim =
      rawKind === 'ios-sim' ||
      rawKind === 'ios-simulator' ||
      rawKind === 'simulator' ||
      devId.includes('simulator') ||
      devName.includes('simulator');

    if (isSim) {
      return { platform: 'ios', kind: 'ios-simulator', isPhysical: false };
    }
    return { platform: 'ios', kind: 'ios-physical', isPhysical: true };
  }

  return { platform: 'android', kind: 'android', isPhysical: rawKind === 'physical' };
}

export function formatMirrorConnectingInfo(
  classification: DeviceClassification,
  serial: string
): { title: string; desc: string } {
  if (classification.platform === 'ios') {
    if (classification.kind === 'ios-physical') {
      return {
        title: 'Connecting to iPhone Display…',
        desc: `Awaiting AVFoundation screen capture stream for ${serial || 'iOS device'}.`,
      };
    }
    return {
      title: 'Connecting to iOS Simulator…',
      desc: `Awaiting simulator screen capture stream for ${serial || 'iOS Simulator'}.`,
    };
  }
  return {
    title: 'Starting scrcpy Server…',
    desc: `Pushing server v4.1 to ${serial}, forwarding adb tunnel, and awaiting H.264 stream.`,
  };
}

export function sanitizeMirrorErrorMessage(
  rawError: any,
  classification: DeviceClassification
): { message: string; isScrcpyMentioned: boolean } {
  let msg = '';
  if (typeof rawError === 'string') {
    msg = rawError;
  } else if (rawError && typeof rawError === 'object') {
    msg = rawError.message || rawError.code || JSON.stringify(rawError);
  } else {
    msg = 'Mirror session failed to start';
  }

  const hasScrcpy = /scrcpy/i.test(msg);
  if (classification.platform === 'ios') {
    // Contract: jangan pernah kata scrcpy untuk iOS
    msg = msg.replace(/\bscrcpy\b/gi, 'mirror service');
  }

  return { message: msg, isScrcpyMentioned: hasScrcpy };
}
