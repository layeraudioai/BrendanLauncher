#include "hbx_sdk.h"
#include "hbx_app.h"
#include "hbx_ui.h"

static char note[128];
static char listing[256];
static uint32_t note_bytes;
static uint32_t listing_bytes;
static enum hbx_fs_status read_status;
static enum hbx_fs_status list_status;
static enum hbx_fs_status action_status;

static void refresh_storage(const struct hbx_ctx *ctx, int create_if_missing) {
    note_bytes = 0;
    listing_bytes = 0;
    read_status = hbx_fs_read(ctx, "notes/welcome.txt", note, sizeof note - 1,
                              &note_bytes);
    if (read_status == HBX_FS_ERR_NOT_FOUND && create_if_missing) {
        static const char initial[] = "Hello from BrendanLauncher storage.";
        action_status = hbx_fs_write(ctx, "notes/welcome.txt", initial,
                                     sizeof initial - 1);
        if (action_status == HBX_FS_OK)
            read_status = hbx_fs_read(ctx, "notes/welcome.txt", note, sizeof note - 1,
                                      &note_bytes);
    }
    if (note_bytes < sizeof note) note[note_bytes] = 0;
    list_status = hbx_fs_list(ctx, "notes", listing, sizeof listing - 1,
                              &listing_bytes);
    if (listing_bytes < sizeof listing) listing[listing_bytes] = 0;
}

int hbx_app_main(const struct hbx_ctx *ctx) {
    struct hbx_input_state input;
    uint64_t deadline = 0;

    if (hbx_ctx_check(ctx) != HBX_OK) return HBX_ERR_ABI;
    action_status = HBX_FS_ERR_UNAVAILABLE;
    refresh_storage(ctx, 1);
    hbx_memset(&input, 0, sizeof input);

    while (!hbx_stop_requested(ctx)) {
        hbx_input_poll(ctx, &input);
        if (input.pressed & HBX_B) break;
        if (input.pressed & HBX_A) {
            static const char updated[] = "Saved by the filesystem demo.";
            action_status = hbx_fs_write(ctx, "notes/welcome.txt", updated,
                                         sizeof updated - 1);
            refresh_storage(ctx, 0);
        } else if (input.pressed & HBX_X) {
            action_status = hbx_fs_remove(ctx, "notes/welcome.txt");
            refresh_storage(ctx, 0);
        }

        hbx_ui_begin(ctx, HBX_RGB(246, 250, 253));
        hbx_ui_text(ctx, 100, 90, HBX_FONT_TITLE, "ABI-3 Host Storage",
                    HBX_RGB(26, 69, 102));
        hbx_ui_text(ctx, 104, 220, HBX_FONT_H2, "Private, per-app host storage",
                    HBX_RGB(5, 110, 170));
        hbx_ui_text(ctx, 104, 285, HBX_FONT_BODY, "notes/welcome.txt:",
                    HBX_RGB(26, 69, 102));
        hbx_ui_text(ctx, 130, 330, HBX_FONT_BODY,
                    read_status == HBX_FS_OK ? note : "Read failed; check the status below.",
                    HBX_RGB(60, 90, 110));
        hbx_ui_text(ctx, 104, 405, HBX_FONT_SMALL,
                    list_status == HBX_FS_OK ? listing : "Directory listing failed.",
                    HBX_RGB(60, 90, 110));
        hbx_ui_text(ctx, 104, 485, HBX_FONT_SMALL,
                    action_status == HBX_FS_OK ? "Last write/remove: OK" :
                    "Last write/remove: not run or failed",
                    action_status == HBX_FS_OK ? HBX_RGB(20, 130, 80) :
                    HBX_RGB(170, 90, 30));
        hbx_ui_text(ctx, 104, 560, HBX_FONT_BODY,
                    "A: write   X: remove   B: return to launcher",
                    HBX_RGB(5, 145, 224));
        if (hbx_ui_present(ctx) != HBX_OK) break;
        hbx_frame_end(ctx);
        hbx_pace(ctx, &deadline, 60);
    }
    return HBX_OK;
}
