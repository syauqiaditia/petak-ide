use std::io::{self, Read};

/// Read a length-prefixed iOS frame packet from a stream (stdout of petak_ios_capture).
/// Packet layout from capture helper:
///   [4 bytes BE: packet_length]
///   [packet_length bytes: [1 byte kind][8 bytes BE pts_us][payload bytes]]
///
/// Returns the contract packet format:
///   `[u8 kind: 0=config, 1=key, 2=delta][u64 pts_us][payload Annex-B bytes]`
pub fn read_ios_frame_packet<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let packet_len = u32::from_be_bytes(len_buf) as usize;
    if packet_len < 9 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("packet length too short: {} (minimum 9 bytes)", packet_len),
        ));
    }

    // Sanity limit: max 10MB per video frame packet
    if packet_len > 10 * 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("packet length exceeds 10MB sanity cap: {}", packet_len),
        ));
    }

    let mut packet = vec![0u8; packet_len];
    reader.read_exact(&mut packet)?;

    Ok(Some(packet))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_ios_frame_packet_valid() {
        let mut data = Vec::new();
        let payload = vec![0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0xc0];
        let pts: u64 = 1_000_000;
        let kind: u8 = 0; // config

        let packet_len = (1 + 8 + payload.len()) as u32;
        data.extend_from_slice(&packet_len.to_be_bytes());
        data.push(kind);
        data.extend_from_slice(&pts.to_be_bytes());
        data.extend_from_slice(&payload);

        let mut cursor = io::Cursor::new(data);
        let res = read_ios_frame_packet(&mut cursor).unwrap().unwrap();

        assert_eq!(res.len(), (1 + 8 + payload.len()));
        assert_eq!(res[0], 0);
        let pts_read = u64::from_be_bytes(res[1..9].try_into().unwrap());
        assert_eq!(pts_read, 1_000_000);
        assert_eq!(&res[9..], &payload[..]);
    }

    #[test]
    fn test_read_ios_frame_packet_eof() {
        let mut cursor = io::Cursor::new(Vec::<u8>::new());
        let res = read_ios_frame_packet(&mut cursor).unwrap();
        assert!(res.is_none());
    }

    #[test]
    fn test_read_ios_frame_packet_too_short() {
        let mut data = Vec::new();
        let packet_len: u32 = 5; // Less than 9
        data.extend_from_slice(&packet_len.to_be_bytes());
        data.extend_from_slice(&[0, 1, 2, 3, 4]);

        let mut cursor = io::Cursor::new(data);
        assert!(read_ios_frame_packet(&mut cursor).is_err());
    }
}
