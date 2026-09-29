/// Binary protocol parsing for scrcpy v4.1 video stream.
///
/// Stream structure (with send_stream_meta=true, send_frame_meta=true, send_device_meta=false):
/// 1. Codec header: 4 bytes codec ID (e.g. b"h264" = 0x68323634)
/// 2. Session meta: 12 bytes [flags 4B][width 4B][height 4B]
///    flags: 0x80000000 = initial, 0x80000001 = orientation changed
/// 3. Video packets:
///    - 8 bytes: pts_raw (be)
///      * bit 63: SESSION flag (new dimensions: width 4B + height 4B follows)
///      * bit 62: CONFIG flag (SPS/PPS Annex-B)
///      * bit 61: KEY_FRAME flag (IDR)
///      * bits 0..60: presentation timestamp (pts) in microseconds
///    - 4 bytes: packet size (be)
///    - N bytes: H.264 Annex-B NAL units
use std::io::{self, Read};

pub const CODEC_H264: u32 = 0x6832_3634; // "h264"
pub const CODEC_H265: u32 = 0x6832_3635; // "h265"
pub const CODEC_AV1: u32 = 0x0061_7631; // "av1"

/// Frame type identifier matching the contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    Config, // SPS+PPS Annex-B
    Key,    // IDR frame
    Delta,  // Non-IDR frame
}

impl FrameKind {
    pub fn as_u8(self) -> u8 {
        match self {
            FrameKind::Config => 0,
            FrameKind::Key => 1,
            FrameKind::Delta => 2,
        }
    }
}

/// Codec metadata sent at the start of the video socket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CodecMeta {
    pub codec_id: u32,
    pub width: u32,
    pub height: u32,
}

/// A parsed video packet with metadata.
#[derive(Debug, Clone)]
pub struct VideoPacket {
    pub kind: FrameKind,
    pub pts_us: u64,
    pub data: Vec<u8>,
}

/// Read the initial codec metadata (16 bytes total: 4B codec + 12B session meta).
pub fn read_codec_meta(r: &mut dyn Read) -> io::Result<CodecMeta> {
    // 1. Read 4-byte codec ID
    let mut codec_buf = [0u8; 4];
    r.read_exact(&mut codec_buf)?;
    let codec_id = u32::from_be_bytes(codec_buf);

    // 2. Read 12-byte session meta: [flags 4B][width 4B][height 4B]
    let mut session_buf = [0u8; 12];
    r.read_exact(&mut session_buf)?;
    let width = u32::from_be_bytes([
        session_buf[4],
        session_buf[5],
        session_buf[6],
        session_buf[7],
    ]);
    let height = u32::from_be_bytes([
        session_buf[8],
        session_buf[9],
        session_buf[10],
        session_buf[11],
    ]);

    Ok(CodecMeta {
        codec_id,
        width,
        height,
    })
}

/// Read one video packet from the video socket.
///
/// Handles session packets (orientation changes) by reading the new dimensions
/// and continuing to the next video packet, or returns None on EOF.
pub fn read_video_packet(r: &mut dyn Read) -> io::Result<Option<VideoPacket>> {
    loop {
        let mut hdr = [0u8; 12];
        match r.read_exact(&mut hdr) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e),
        }

        let pts_raw = u64::from_be_bytes([
            hdr[0], hdr[1], hdr[2], hdr[3], hdr[4], hdr[5], hdr[6], hdr[7],
        ]);
        let size = u32::from_be_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;

        // Bit 63: SESSION packet (orientation change: payload is 8 bytes [width 4B][height 4B])
        let is_session = (pts_raw >> 63) & 1 == 1;
        if is_session {
            // Discard session packet payload and continue to next packet
            let mut session_payload = vec![0u8; size];
            r.read_exact(&mut session_payload)?;
            continue;
        }

        // Bit 62: CONFIG (SPS/PPS)
        // Bit 61: KEY_FRAME (IDR)
        // Bits 0..60: presentation timestamp
        let is_config = (pts_raw >> 62) & 1 == 1;
        let is_key = (pts_raw >> 61) & 1 == 1;
        let pts_us = pts_raw & 0x1FFF_FFFF_FFFF_FFFF;

        let mut data = vec![0u8; size];
        r.read_exact(&mut data)?;

        let kind = if is_config {
            FrameKind::Config
        } else if is_key {
            FrameKind::Key
        } else {
            FrameKind::Delta
        };

        return Ok(Some(VideoPacket { kind, pts_us, data }));
    }
}

/// Serialize a VideoPacket into the contract binary format:
/// [u8 kind] [u64be pts_us] [payload]
/// This is what gets sent over the Tauri Channel / example stdout.
pub fn encode_frame_packet(pkt: &VideoPacket) -> Vec<u8> {
    let mut buf = Vec::with_capacity(1 + 8 + pkt.data.len());
    buf.push(pkt.kind.as_u8());
    buf.extend_from_slice(&pkt.pts_us.to_be_bytes());
    buf.extend_from_slice(&pkt.data);
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_read_codec_meta() {
        let mut buf = Vec::new();
        // 4 bytes codec
        buf.extend_from_slice(&CODEC_H264.to_be_bytes());
        // 12 bytes session meta: [flags 4B][width 4B][height 4B]
        buf.extend_from_slice(&0x8000_0000u32.to_be_bytes());
        buf.extend_from_slice(&864u32.to_be_bytes());
        buf.extend_from_slice(&1920u32.to_be_bytes());

        let meta = read_codec_meta(&mut Cursor::new(&buf)).unwrap();
        assert_eq!(meta.codec_id, CODEC_H264);
        assert_eq!(meta.width, 864);
        assert_eq!(meta.height, 1920);
    }

    #[test]
    fn test_read_video_packet_config() {
        let mut buf = Vec::new();
        // Bit 62 = config: pts_raw = (1 << 62) | 0
        let pts_raw: u64 = 1 << 62;
        let payload = vec![0x00, 0x00, 0x00, 0x01, 0x67, 0x42]; // SPS
        buf.extend_from_slice(&pts_raw.to_be_bytes());
        buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        buf.extend_from_slice(&payload);

        let pkt = read_video_packet(&mut Cursor::new(&buf)).unwrap().unwrap();
        assert_eq!(pkt.kind, FrameKind::Config);
        assert_eq!(pkt.pts_us, 0);
        assert_eq!(pkt.data, payload);
    }

    #[test]
    fn test_read_video_packet_key() {
        let mut buf = Vec::new();
        // Bit 61 = key: pts_raw = (1 << 61) | 12345
        let pts_raw: u64 = (1 << 61) | 12345;
        let payload = vec![0x00, 0x00, 0x00, 0x01, 0x65, 0x01]; // IDR
        buf.extend_from_slice(&pts_raw.to_be_bytes());
        buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        buf.extend_from_slice(&payload);

        let pkt = read_video_packet(&mut Cursor::new(&buf)).unwrap().unwrap();
        assert_eq!(pkt.kind, FrameKind::Key);
        assert_eq!(pkt.pts_us, 12345);
        assert_eq!(pkt.data, payload);
    }

    #[test]
    fn test_read_video_packet_delta() {
        let mut buf = Vec::new();
        // Bits 62, 61 = 0: pts_raw = 67890
        let pts_raw: u64 = 67890;
        let payload = vec![0x00, 0x00, 0x00, 0x01, 0x61, 0x02]; // Non-IDR
        buf.extend_from_slice(&pts_raw.to_be_bytes());
        buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        buf.extend_from_slice(&payload);

        let pkt = read_video_packet(&mut Cursor::new(&buf)).unwrap().unwrap();
        assert_eq!(pkt.kind, FrameKind::Delta);
        assert_eq!(pkt.pts_us, 67890);
        assert_eq!(pkt.data, payload);
    }

    #[test]
    fn test_encode_frame_packet() {
        let pkt = VideoPacket {
            kind: FrameKind::Key,
            pts_us: 1000,
            data: vec![1, 2, 3, 4],
        };
        let encoded = encode_frame_packet(&pkt);
        assert_eq!(encoded[0], FrameKind::Key.as_u8());
        assert_eq!(&encoded[1..9], &1000u64.to_be_bytes());
        assert_eq!(&encoded[9..], &[1, 2, 3, 4]);
    }

    #[test]
    fn test_read_video_packet_eof() {
        let buf: Vec<u8> = Vec::new();
        let pkt = read_video_packet(&mut Cursor::new(&buf)).unwrap();
        assert!(pkt.is_none());
    }

    #[test]
    fn test_read_multiple_packets() {
        let mut buf = Vec::new();

        // 1. Config packet
        buf.extend_from_slice(&(1u64 << 62).to_be_bytes());
        buf.extend_from_slice(&2u32.to_be_bytes());
        buf.extend_from_slice(&[0x67, 0x42]);

        // 2. Key packet
        buf.extend_from_slice(&((1u64 << 61) | 500u64).to_be_bytes());
        buf.extend_from_slice(&3u32.to_be_bytes());
        buf.extend_from_slice(&[0x65, 0x01, 0x02]);

        // 3. Delta packet
        buf.extend_from_slice(&1000u64.to_be_bytes());
        buf.extend_from_slice(&1u32.to_be_bytes());
        buf.extend_from_slice(&[0x61]);

        let mut cursor = Cursor::new(&buf);
        let p1 = read_video_packet(&mut cursor).unwrap().unwrap();
        assert_eq!(p1.kind, FrameKind::Config);

        let p2 = read_video_packet(&mut cursor).unwrap().unwrap();
        assert_eq!(p2.kind, FrameKind::Key);
        assert_eq!(p2.pts_us, 500);

        let p3 = read_video_packet(&mut cursor).unwrap().unwrap();
        assert_eq!(p3.kind, FrameKind::Delta);
        assert_eq!(p3.pts_us, 1000);

        let p4 = read_video_packet(&mut cursor).unwrap();
        assert!(p4.is_none());
    }
}
