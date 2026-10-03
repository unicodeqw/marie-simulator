//! Десктопна оболонка. Симулятор працює як WebAssembly всередині webview;
//! Rust тут лише надає нативні діалоги та доступ до файлів.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
