use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

#[allow(dead_code)]
pub fn build_app_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let petak_menu = SubmenuBuilder::new(app_handle, "Petak")
        .about(None)
        .item(&MenuItemBuilder::with_id("settings", "Settings").accelerator("CmdOrCtrl+,").build(app_handle)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app_handle, "File")
        .item(&MenuItemBuilder::with_id("new_file", "New File").accelerator("CmdOrCtrl+N").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("open_folder", "Open Folder...").accelerator("CmdOrCtrl+O").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("open_recent", "Open Recent").build(app_handle)?)
        .separator()
        .item(&MenuItemBuilder::with_id("save_file", "Save").accelerator("CmdOrCtrl+S").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("save_all", "Save All").accelerator("Alt+CmdOrCtrl+S").build(app_handle)?)
        .separator()
        .item(&MenuItemBuilder::with_id("close_tab", "Close Tab").accelerator("CmdOrCtrl+W").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("close_window", "Close Window").accelerator("Shift+CmdOrCtrl+W").build(app_handle)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app_handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&MenuItemBuilder::with_id("find_in_file", "Find in File").accelerator("CmdOrCtrl+F").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("replace", "Replace").accelerator("CmdOrCtrl+R").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("search_in_project", "Search in Project").accelerator("Shift+CmdOrCtrl+F").build(app_handle)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app_handle, "View")
        .item(&MenuItemBuilder::with_id("toggle_tree", "Toggle File Tree").accelerator("CmdOrCtrl+B").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("toggle_terminal", "Toggle Terminal").accelerator("CmdOrCtrl+J").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("toggle_agents", "Toggle AI Agents").accelerator("CmdOrCtrl+6").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("toggle_mirror", "Toggle Device Mirror").accelerator("Shift+CmdOrCtrl+D").build(app_handle)?)
        .separator()
        .fullscreen()
        .item(&MenuItemBuilder::with_id("zen_mode", "Zen Mode").build(app_handle)?)
        .build()?;

    let nav_menu = SubmenuBuilder::new(app_handle, "Navigate")
        .item(&MenuItemBuilder::with_id("search_everywhere", "Search Everywhere").accelerator("CmdOrCtrl+P").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("goto_symbol", "Go to Symbol").accelerator("Alt+CmdOrCtrl+O").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("goto_line", "Go to Line...").accelerator("CmdOrCtrl+G").build(app_handle)?)
        .separator()
        .item(&MenuItemBuilder::with_id("next_problem", "Next Problem").accelerator("F2").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("prev_problem", "Previous Problem").accelerator("Shift+F2").build(app_handle)?)
        .build()?;

    let code_menu = SubmenuBuilder::new(app_handle, "Code")
        .item(&MenuItemBuilder::with_id("format_document", "Format Document").accelerator("Alt+Shift+F").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("quick_fix", "Quick Fix / Code Action").accelerator("CmdOrCtrl+.").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("organize_imports", "Organize Imports").accelerator("Alt+Shift+O").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("ai_completion", "AI Inline Completion").accelerator("Tab").build(app_handle)?)
        .build()?;

    let refactor_menu = SubmenuBuilder::new(app_handle, "Refactor")
        .item(&MenuItemBuilder::with_id("rename_symbol", "Rename Symbol").accelerator("Shift+F6").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("extract_widget", "Extract Widget").accelerator("Alt+CmdOrCtrl+W").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("extract_method", "Extract Method").accelerator("Alt+CmdOrCtrl+M").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("move_file", "Move File").accelerator("F6").build(app_handle)?)
        .build()?;

    let build_menu = SubmenuBuilder::new(app_handle, "Build")
        .item(&MenuItemBuilder::with_id("build_apk", "Flutter Build APK").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("build_ios", "Flutter Build iOS").build(app_handle)?)
        .separator()
        .item(&MenuItemBuilder::with_id("gradle_clean", "Gradle Clean Build").build(app_handle)?)
        .build()?;

    let run_menu = SubmenuBuilder::new(app_handle, "Run")
        .item(&MenuItemBuilder::with_id("start_debug", "Start Debugging").accelerator("F5").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("run_no_debug", "Run Without Debugging").accelerator("Ctrl+F5").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("hot_reload", "Flutter Hot Reload").accelerator("CmdOrCtrl+\\").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("hot_restart", "Flutter Hot Restart").accelerator("Shift+CmdOrCtrl+\\").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("stop_run", "Stop").accelerator("Shift+F5").build(app_handle)?)
        .separator()
        .item(&MenuItemBuilder::with_id("run_test_scenario", "Run Test Scenario").accelerator("Shift+CmdOrCtrl+T").build(app_handle)?)
        .build()?;

    let git_menu = SubmenuBuilder::new(app_handle, "Git")
        .item(&MenuItemBuilder::with_id("git_commit", "Commit...").accelerator("CmdOrCtrl+K").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("git_push", "Push...").accelerator("Shift+CmdOrCtrl+K").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("git_pull", "Pull/Update").accelerator("CmdOrCtrl+T").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("git_branches", "Branches...").build(app_handle)?)
        .separator()
        .item(&MenuItemBuilder::with_id("gitlab_mr", "GitLab Merge Requests").accelerator("CmdOrCtrl+5").build(app_handle)?)
        .build()?;

    let tools_menu = SubmenuBuilder::new(app_handle, "Tools")
        .item(&MenuItemBuilder::with_id("toolchain_doctor", "Toolchain Doctor").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("scrcpy_manager", "Scrcpy Device Manager").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("kotlin_ls_manager", "Kotlin LS Manager").build(app_handle)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app_handle, "Window")
        .minimize()
        .maximize_with_text("Zoom")
        .separator()
        .bring_all_to_front()
        .separator()
        .item(&MenuItemBuilder::with_id("tool_window_tests", "Tests & Automation").accelerator("CmdOrCtrl+4").build(app_handle)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app_handle, "Help")
        .item(&MenuItemBuilder::with_id("documentation", "Documentation").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts Reference").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("release_notes", "Release Notes").build(app_handle)?)
        .item(&MenuItemBuilder::with_id("about_petak", "About Petak").build(app_handle)?)
        .build()?;

    MenuBuilder::new(app_handle)
        .items(&[
            &petak_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &nav_menu,
            &code_menu,
            &refactor_menu,
            &build_menu,
            &run_menu,
            &git_menu,
            &tools_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}
