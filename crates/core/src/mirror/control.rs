/// scrcpy v4.1 control message serializer.
///
/// Binary protocol: type byte + fields, all big-endian.
/// We only implement the subset needed by the contract InputEvent.
use std::io::{self, Write};

use serde::{Deserialize, Serialize};

/// InputEvent from the UI (matches the contract in device-mirror-contract.md).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum InputEvent {
    #[serde(rename = "touch")]
    Touch {
        action: TouchAction,
        x: u32,
        y: u32,
        #[serde(default = "default_w")]
        w: u16,
        #[serde(default = "default_h")]
        h: u16,
    },
    #[serde(rename = "scroll")]
    Scroll {
        x: u32,
        y: u32,
        w: u16,
        h: u16,
        dx: f32,
        dy: f32,
    },
    #[serde(rename = "key")]
    Key { keycode: u32, action: KeyAction },
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "nav")]
    Nav { key: NavKey },
    #[serde(rename = "rotate")]
    Rotate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TouchAction {
    Down,
    Move,
    Up,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyAction {
    Down,
    Up,
}

fn default_w() -> u16 { 1080 }
fn default_h() -> u16 { 2400 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NavKey {
    Back,
    Home,
    Recents,
    Power,
    #[serde(alias = "volume_up", alias = "volumeup")]
    Volup,
    #[serde(alias = "volume_down", alias = "volumedown")]
    Voldown,
}

// scrcpy control message type constants
const TYPE_INJECT_KEYCODE: u8 = 0;
const TYPE_INJECT_TEXT: u8 = 1;
const TYPE_INJECT_TOUCH: u8 = 2;
const TYPE_INJECT_SCROLL: u8 = 3;
const TYPE_BACK_OR_SCREEN_ON: u8 = 4;
const TYPE_ROTATE_DEVICE: u8 = 11;

// Android KeyEvent action constants
const AKEY_ACTION_DOWN: u8 = 0;
const AKEY_ACTION_UP: u8 = 1;

// Android MotionEvent action constants
const AMOTION_ACTION_DOWN: u8 = 0;
const AMOTION_ACTION_UP: u8 = 1;
const AMOTION_ACTION_MOVE: u8 = 2;

// Android keycodes for nav keys
const AKEYCODE_BACK: u32 = 4;
const AKEYCODE_HOME: u32 = 3;
const AKEYCODE_APP_SWITCH: u32 = 187;
const AKEYCODE_POWER: u32 = 26;
const AKEYCODE_VOLUME_UP: u32 = 24;
const AKEYCODE_VOLUME_DOWN: u32 = 25;

// Pointer IDs
const POINTER_ID_GENERIC_FINGER: u64 = u64::MAX - 1;

/// Serialize an InputEvent into scrcpy binary control message(s).
pub fn serialize(ev: &InputEvent, w: &mut dyn Write) -> io::Result<()> {
    match ev {
        InputEvent::Touch {
            action,
            x,
            y,
            w: sw,
            h: sh,
        } => {
            let act = match action {
                TouchAction::Down => AMOTION_ACTION_DOWN,
                TouchAction::Move => AMOTION_ACTION_MOVE,
                TouchAction::Up => AMOTION_ACTION_UP,
            };
            let mut buf = [0u8; 32];
            buf[0] = TYPE_INJECT_TOUCH;
            buf[1] = act;
            buf[2..10].copy_from_slice(&POINTER_ID_GENERIC_FINGER.to_be_bytes());
            buf[10..14].copy_from_slice(&x.to_be_bytes());
            buf[14..18].copy_from_slice(&y.to_be_bytes());
            buf[18..20].copy_from_slice(&sw.to_be_bytes());
            buf[20..22].copy_from_slice(&sh.to_be_bytes());
            // pressure: u16 fixed-point, 1.0 = 0xFFFF for down/move, 0 for up
            let pressure: u16 = match action {
                TouchAction::Up => 0,
                _ => 0xFFFF,
            };
            buf[22..24].copy_from_slice(&pressure.to_be_bytes());
            // action_button: u32 = 0, buttons: u32 = 0
            // buf[24..28] and buf[28..32] are already 0
            w.write_all(&buf)
        }
        InputEvent::Scroll {
            x,
            y,
            w: sw,
            h: sh,
            dx,
            dy,
        } => {
            let mut buf = [0u8; 25];
            buf[0] = TYPE_INJECT_SCROLL;
            buf[1..5].copy_from_slice(&x.to_be_bytes());
            buf[5..9].copy_from_slice(&y.to_be_bytes());
            buf[9..11].copy_from_slice(&sw.to_be_bytes());
            buf[11..13].copy_from_slice(&sh.to_be_bytes());
            // hscroll and vscroll as IEEE 754 f32 big-endian
            buf[13..17].copy_from_slice(&dx.to_be_bytes());
            buf[17..21].copy_from_slice(&dy.to_be_bytes());
            // buttons: u32 = 0
            // buf[21..25] already 0
            w.write_all(&buf)
        }
        InputEvent::Key { keycode, action } => {
            let act = match action {
                KeyAction::Down => AKEY_ACTION_DOWN,
                KeyAction::Up => AKEY_ACTION_UP,
            };
            let mut buf = [0u8; 14];
            buf[0] = TYPE_INJECT_KEYCODE;
            buf[1] = act;
            buf[2..6].copy_from_slice(&keycode.to_be_bytes());
            // repeat: u32 = 0, metastate: u32 = 0
            w.write_all(&buf)
        }
        InputEvent::Text { text } => {
            let bytes = text.as_bytes();
            let len = bytes.len().min(300) as u32;
            let mut buf = Vec::with_capacity(5 + len as usize);
            buf.push(TYPE_INJECT_TEXT);
            buf.extend_from_slice(&len.to_be_bytes());
            buf.extend_from_slice(&bytes[..len as usize]);
            w.write_all(&buf)
        }
        InputEvent::Nav { key } => {
            let keycode = match key {
                NavKey::Back => AKEYCODE_BACK,
                NavKey::Home => AKEYCODE_HOME,
                NavKey::Recents => AKEYCODE_APP_SWITCH,
                NavKey::Power => AKEYCODE_POWER,
                NavKey::Volup => AKEYCODE_VOLUME_UP,
                NavKey::Voldown => AKEYCODE_VOLUME_DOWN,
            };
            if matches!(key, NavKey::Back) {
                // Use BACK_OR_SCREEN_ON for the back key (also turns screen on)
                let mut buf = [0u8; 2];
                buf[0] = TYPE_BACK_OR_SCREEN_ON;
                buf[1] = AKEY_ACTION_DOWN;
                w.write_all(&buf)?;
                buf[1] = AKEY_ACTION_UP;
                w.write_all(&buf)
            } else {
                // Send key down and key up (non-blocking, zero lock starvation)
                let down = InputEvent::Key {
                    keycode,
                    action: KeyAction::Down,
                };
                let up = InputEvent::Key {
                    keycode,
                    action: KeyAction::Up,
                };
                serialize(&down, w)?;
                serialize(&up, w)
            }
        }
        InputEvent::Rotate => w.write_all(&[TYPE_ROTATE_DEVICE]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_touch_down() {
        let ev = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 1080,
            h: 1920,
        };
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        assert_eq!(buf.len(), 32);
        assert_eq!(buf[0], TYPE_INJECT_TOUCH);
        assert_eq!(buf[1], AMOTION_ACTION_DOWN);
        // pointer_id = POINTER_ID_GENERIC_FINGER
        assert_eq!(
            u64::from_be_bytes(buf[2..10].try_into().unwrap()),
            POINTER_ID_GENERIC_FINGER
        );
        assert_eq!(u32::from_be_bytes(buf[10..14].try_into().unwrap()), 100);
        assert_eq!(u32::from_be_bytes(buf[14..18].try_into().unwrap()), 200);
        assert_eq!(u16::from_be_bytes(buf[18..20].try_into().unwrap()), 1080);
        assert_eq!(u16::from_be_bytes(buf[20..22].try_into().unwrap()), 1920);
        assert_eq!(u16::from_be_bytes(buf[22..24].try_into().unwrap()), 0xFFFF);
        // pressure
    }

    #[test]
    fn test_serialize_touch_up_zero_pressure() {
        let ev = InputEvent::Touch {
            action: TouchAction::Up,
            x: 0,
            y: 0,
            w: 1080,
            h: 1920,
        };
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        assert_eq!(buf[1], AMOTION_ACTION_UP);
        assert_eq!(u16::from_be_bytes(buf[22..24].try_into().unwrap()), 0);
    }

    #[test]
    fn test_serialize_scroll() {
        let ev = InputEvent::Scroll {
            x: 540,
            y: 960,
            w: 1080,
            h: 1920,
            dx: 0.0,
            dy: -1.0,
        };
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        assert_eq!(buf.len(), 25);
        assert_eq!(buf[0], TYPE_INJECT_SCROLL);
    }

    #[test]
    fn test_serialize_keycode() {
        let ev = InputEvent::Key {
            keycode: 66, // ENTER
            action: KeyAction::Down,
        };
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        assert_eq!(buf.len(), 14);
        assert_eq!(buf[0], TYPE_INJECT_KEYCODE);
        assert_eq!(buf[1], AKEY_ACTION_DOWN);
        assert_eq!(u32::from_be_bytes(buf[2..6].try_into().unwrap()), 66);
    }

    #[test]
    fn test_serialize_text() {
        let ev = InputEvent::Text {
            text: "hello".to_string(),
        };
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        assert_eq!(buf[0], TYPE_INJECT_TEXT);
        assert_eq!(u32::from_be_bytes(buf[1..5].try_into().unwrap()), 5);
        assert_eq!(&buf[5..], b"hello");
    }

    #[test]
    fn test_serialize_nav_back() {
        let ev = InputEvent::Nav { key: NavKey::Back };
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        // Should be 2 BACK_OR_SCREEN_ON messages (down + up)
        assert_eq!(buf.len(), 4);
        assert_eq!(buf[0], TYPE_BACK_OR_SCREEN_ON);
        assert_eq!(buf[1], AKEY_ACTION_DOWN);
        assert_eq!(buf[2], TYPE_BACK_OR_SCREEN_ON);
        assert_eq!(buf[3], AKEY_ACTION_UP);
    }

    #[test]
    fn test_serialize_nav_home() {
        let ev = InputEvent::Nav { key: NavKey::Home };
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        // Should be 2 INJECT_KEYCODE messages (down + up)
        assert_eq!(buf.len(), 28);
        assert_eq!(buf[0], TYPE_INJECT_KEYCODE);
        assert_eq!(buf[14], TYPE_INJECT_KEYCODE);
    }

    #[test]
    fn test_serialize_rotate() {
        let ev = InputEvent::Rotate;
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        assert_eq!(buf, vec![TYPE_ROTATE_DEVICE]);
    }

    #[test]
    fn test_input_event_json_roundtrip() {
        let ev = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 1080,
            h: 1920,
        };
        let json = serde_json::to_string(&ev).unwrap();
        let parsed: InputEvent = serde_json::from_str(&json).unwrap();
        let mut buf1 = Vec::new();
        let mut buf2 = Vec::new();
        serialize(&ev, &mut buf1).unwrap();
        serialize(&parsed, &mut buf2).unwrap();
        assert_eq!(buf1, buf2);
    }

    #[test]
    fn test_input_event_json_parse() {
        let json = r#"{"t":"touch","action":"down","x":100,"y":200,"w":1080,"h":1920}"#;
        let ev: InputEvent = serde_json::from_str(json).unwrap();
        let mut buf = Vec::new();
        serialize(&ev, &mut buf).unwrap();
        assert_eq!(buf[0], TYPE_INJECT_TOUCH);
    }
}
