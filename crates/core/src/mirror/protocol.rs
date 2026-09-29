/// scrcpy v4.1 video stream protocol parser.
///
/// Wire format (sendCodecMeta=true, sendFrameMeta=true):
///   Codec meta (12 bytes): u32be codec_id, u32be width, u32be height
///   Then per-packet: 12-byte header + payload
///     Header: [CK......] [u62be PTS] [u32be packet_size]
///       bit 63 = config packet (SPS/PPS)
///       bit 62 = key frame
///       bits 0-61 = PTS in microseconds
///     Payload: raw Annex-B H.264 bytes
use std::io::{self, Read};

/// Codec IDs matching scrcpy's values.
pub const CODEC_H264: u32 = 0x68323634; // "h264"

/// A parsed video packet ready for the UI channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoPacket {
    pub kind: FrameKind,
    pub pts_us: u64,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    Config, // SPS+PPS Annex-B
    Key,
    Delta,
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
#[derive(Debug, Clone, Copy)]
pub struct CodecMeta {
    pub codec_id: u32,
    pub width: u32,
    pub height: u32,
}

/// Read the 12-byte codec metadata from the video socket.
pub fn read_codec_meta(r: &mut dyn Read) -> io::Result<CodecMeta> {
    let mut buf = [0u8; 12];
    r.read_exact(&mut buf)?;
    Ok(CodecMeta {
        codec_id: u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]),
        width: u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]),
        height: u32::from_be_bytes([buf[8], buf[9], buf[10], buf[11]]),
    })
}

/// Read one video packet (12-byte header + payload) from the video socket.
/// Returns None on EOF.
pub fn read_video_packet(r: &mut dyn Read) -> io::Result<Option<VideoPacket>> {
    let mut hdr = [0u8; 12];
    match r.read_exact(&mut hdr) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let pts_raw = u64::from_be_bytes([
        hdr[0], hdr[1], hdr[2], hdr[3], hdr[4], hdr[5], hdr[6], hdr[7],
    ]);
    let is_config = (pts_raw >> 63) & 1 == 1;
    let is_key = (pts_raw >> 62) & 1 == 1;
    let pts_us = pts_raw & 0x3FFF_FFFF_FFFF_FFFF;

    let pkt_size = u32::from_be_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;

    let mut data = vec![0u8; pkt_size];
    r.read_exact(&mut data)?;

    let kind = if is_config {
        FrameKind::Config
    } else if is_key {
        FrameKind::Key
    } else {
        FrameKind::Delta
    };

    Ok(Some(VideoPacket { kind, pts_us, data }))
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
        buf.extend_from_slice(&CODEC_H264.to_be_bytes());
        buf.extend_from_slice(&1080u32.to_be_bytes());
        buf.extend_from_slice(&1920u32.to_be_bytes());

        let meta = read_codec_meta(&mut Cursor::new(&buf)).unwrap();
        assert_eq!(meta.codec_id, CODEC_H264);
        assert_eq!(meta.width, 1080);
        assert_eq!(meta.height, 1920);
    }

    #[test]
    fn test_read_video_packet_config() {
        // Config packet: bit 63 set, pts=0, 4 bytes payload
        let pts_with_flag: u64 = 1u64 << 63; // config flag
        let payload = b"\x00\x00\x00\x01";
        let pkt_size: u32 = payload.len() as u32;

        let mut buf = Vec::new();
        buf.extend_from_slice(&pts_with_flag.to_be_bytes());
        buf.extend_from_slice(&pkt_size.to_be_bytes());
        buf.extend_from_slice(payload);

        let pkt = read_video_packet(&mut Cursor::new(&buf)).unwrap().unwrap();
        assert_eq!(pkt.kind, FrameKind::Config);
        assert_eq!(pkt.pts_us, 0);
        assert_eq!(pkt.data, payload);
    }

    #[test]
    fn test_read_video_packet_key() {
        let pts_with_flag: u64 = (1u64 << 62) | 12345;
        let payload = b"KEYFRAME";
        let pkt_size: u32 = payload.len() as u32;

        let mut buf = Vec::new();
        buf.extend_from_slice(&pts_with_flag.to_be_bytes());
        buf.extend_from_slice(&pkt_size.to_be_bytes());
        buf.extend_from_slice(payload);

        let pkt = read_video_packet(&mut Cursor::new(&buf)).unwrap().unwrap();
        assert_eq!(pkt.kind, FrameKind::Key);
        assert_eq!(pkt.pts_us, 12345);
        assert_eq!(pkt.data, b"KEYFRAME");
    }

    #[test]
    fn test_read_video_packet_delta() {
        let pts: u64 = 99999;
        let payload = b"DELTA";

        let mut buf = Vec::new();
        buf.extend_from_slice(&pts.to_be_bytes());
        buf.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        buf.extend_from_slice(payload);

        let pkt = read_video_packet(&mut Cursor::new(&buf)).unwrap().unwrap();
        assert_eq!(pkt.kind, FrameKind::Delta);
        assert_eq!(pkt.pts_us, 99999);
    }

    #[test]
    fn test_read_video_packet_eof() {
        let pkt = read_video_packet(&mut Cursor::new(&[])).unwrap();
        assert!(pkt.is_none());
    }

    #[test]
    fn test_encode_frame_packet() {
        let pkt = VideoPacket {
            kind: FrameKind::Key,
            pts_us: 42,
            data: vec![1, 2, 3],
        };
        let encoded = encode_frame_packet(&pkt);
        assert_eq!(encoded[0], 1); // FrameKind::Key
        assert_eq!(u64::from_be_bytes(encoded[1..9].try_into().unwrap()), 42);
        assert_eq!(&encoded[9..], &[1, 2, 3]);
    }

    #[test]
    fn test_read_multiple_packets() {
        let mut stream = Vec::new();
        // Packet 1: config
        let pts1: u64 = 1u64 << 63;
        stream.extend_from_slice(&pts1.to_be_bytes());
        stream.extend_from_slice(&4u32.to_be_bytes());
        stream.extend_from_slice(b"SPS!");
        // Packet 2: key
        let pts2: u64 = (1u64 << 62) | 100;
        stream.extend_from_slice(&pts2.to_be_bytes());
        stream.extend_from_slice(&3u32.to_be_bytes());
        stream.extend_from_slice(b"KEY");

        let mut cursor = Cursor::new(&stream);
        let p1 = read_video_packet(&mut cursor).unwrap().unwrap();
        assert_eq!(p1.kind, FrameKind::Config);
        let p2 = read_video_packet(&mut cursor).unwrap().unwrap();
        assert_eq!(p2.kind, FrameKind::Key);
        assert_eq!(p2.pts_us, 100);
        let p3 = read_video_packet(&mut cursor).unwrap();
        assert!(p3.is_none());
    }
}
