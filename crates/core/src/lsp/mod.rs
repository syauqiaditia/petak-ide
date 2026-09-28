// LSP client module: JSON-RPC framing, server lifecycle, language registry.

pub mod edit;
pub mod pos;
pub mod registry;
pub mod rpc;
pub mod server;

pub use edit::{apply_edits, EditError, TextEdit};
pub use registry::{Clock, Lang, Registry, WallClock};
pub use server::{Server, ServerConfig, ServerError, ServerEvent};
