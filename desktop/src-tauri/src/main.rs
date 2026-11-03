#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Desktop shell only; room signaling, seek synchronization and player controls
// live in the exact same shared HTML/JS used by the web/mobile builds.
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("MarmaladePlayer desktop application could not launch");
}
