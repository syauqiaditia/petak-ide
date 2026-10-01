
use std::io::{self, Read};

pub const CODEC_H264: u32 = 0x6832_3634; // "h264"
pub const CODEC_H265: u32 = 0x6832_3635; // "h265"
pub const CODEC_AV1: u32 = 0x0061_7631; // "av1"

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CodecMeta {
    pub codec_id: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct VideoPacket {
    pub kind: FrameKind,
    pub pts_us: u64,
    pub data: Vec<u8>,
}

/// Read codec metadata. In scrcpy 4.1 stream format:
/// 1. 4 bytes codec ID ('h264')
/// 2. Then a 12-byte session header: [1B flag (0x80)][3B pad][4B width][4B height]
pub fn read_codec_meta(r: &mut dyn Read) -> io::Result<CodecMeta> {
    // 1. Read 4-byte codec ID
    let mut codec_buf = [0u8; 4];
    r.read_exact(&mut codec_buf)?;
    let codec_id = u32::from_be_bytes(codec_buf);

    // 2. Read 12-byte session header
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

/// Read one video packet from the video socket according to official scrcpy demuxer spec.
pub fn read_video_packet(r: &mut dyn Read) -> io::Result<Option<VideoPacket>> {
    loop {
        let mut hdr = [0u8; 12];
        match r.read_exact(&mut hdr) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e),
        }

        // In scrcpy protocol: if MSB (hdr[0] & 0x80) is 1, it is a SESSION PACKET (12 bytes total, NO PAYLOAD!)
        if hdr[0] & 0x80 != 0 {
            // New dimensions are in bytes 4..12: [width 4B][height 4B]
            continue;
        }

        // Media packet:
        // Byte 0..8: PTS (64-bit big endian)
        // Bit 62 (hdr[0] & 0x40): CONFIG (SPS/PPS)
        // Bit 61 (hdr[0] & 0x20): KEY_FRAME (IDR)
        let is_config = hdr[0] & 0x40 != 0;
        let is_key = hdr[0] & 0x20 != 0;

        let mut pts_bytes = [0u8; 8];
        pts_bytes.copy_from_slice(&hdr[0..8]);
        pts_bytes[0] &= 0x1F; // Clear top 3 flag bits
        let pts_us = u64::from_be_bytes(pts_bytes);

        let size = u32::from_be_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]) as usize;
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

pub fn encode_frame_packet(pkt: &VideoPacket) -> Vec<u8> {
    let mut buf = Vec::with_capacity(1 + 8 + pkt.data.len());
    buf.push(pkt.kind.as_u8());
    buf.extend_from_slice(&pkt.pts_us.to_be_bytes());
    buf.extend_from_slice(&pkt.data);
    buf
}
