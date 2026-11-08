/*
 * Brendan NRO Launcher — Ozone/libnx-ounce companion prototype.
 *
 * This is a real Horizon homebrew NRO, not a BrendanLauncher GPU app. It must
 * be started by a compatible homebrew loader which provides NextLoadPath.
 * It only chainloads an NRO from SD via libnx-ounce envSetNextLoad().
 */
#include <switch.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>

#define MAX_NROS 64
#define NAME_BYTES FS_MAX_PATH
#define PATH_BYTES 256
#define PAGE_ROWS 18
#define NRO_MAGIC 0x304f524e

typedef struct {
    char name[NAME_BYTES];
    s64 bytes;
} NroEntry;

static NroEntry g_entries[MAX_NROS];
static size_t g_count;
static FsFileSystem g_sd;
static int g_fs_open;
static char g_message[160];

static int is_nro_name(const char *name) {
    size_t n = strlen(name);
    return n >= 4 && name[n-4] == '.' &&
        tolower((unsigned char)name[n-3]) == 'n' &&
        tolower((unsigned char)name[n-2]) == 'r' &&
        tolower((unsigned char)name[n-1]) == 'o';
}

static int valid_nro(const char *relative, s64 expected_size) {
    FsFile f;
    if (R_FAILED(fsFsOpenFile(&g_sd, relative, FsOpenMode_Read, &f))) return 0;
    u8 header[0x70]; u64 got = 0; s64 actual = 0;
    Result r = fsFileGetSize(&f, &actual);
    if (R_SUCCEEDED(r)) r = fsFileRead(&f, 0x10, header, sizeof(header), FsReadOption_None, &got);
    fsFileClose(&f);
    if (R_FAILED(r) || got != sizeof(header) || actual < 0x80 || actual != expected_size) return 0;
    u32 magic = 0, image_size = 0;
    memcpy(&magic, header, sizeof(magic));
    memcpy(&image_size, header + 8, sizeof(image_size));
    if (magic != NRO_MAGIC || image_size < 0x80 || image_size > (u64)actual) return 0;
    /* Reject malformed code/rodata/data spans before asking another process to load them. */
    for (u32 i = 0; i < 3; i++) {
        u32 offset = 0, size = 0;
        memcpy(&offset, header + 0x10 + i * 8, sizeof(offset));
        memcpy(&size, header + 0x14 + i * 8, sizeof(size));
        if (offset > image_size || size > image_size - offset) return 0;
    }
    return 1;
}

static void scan_sd(void) {
    g_count = 0;
    FsDir dir;
    Result r = fsFsOpenDirectory(&g_sd, "/switch", FsDirOpenMode_ReadFiles, &dir);
    if (R_FAILED(r)) {
        snprintf(g_message, sizeof(g_message), "Cannot open SD:/switch (result 0x%08X)", (unsigned)r);
        return;
    }
    FsDirectoryEntry entry;
    s64 read = 0;
    while (g_count < MAX_NROS && R_SUCCEEDED(fsDirRead(&dir, &read, 1, &entry)) && read > 0) {
        if (entry.type != FsDirEntryType_File || !is_nro_name(entry.name)) continue;
        char relative[PATH_BYTES];
        int n = snprintf(relative, sizeof(relative), "/switch/%s", entry.name);
        if (n <= 0 || (size_t)n >= sizeof(relative) || !valid_nro(relative, entry.file_size)) continue;
        strncpy(g_entries[g_count].name, entry.name, sizeof(g_entries[g_count].name)-1);
        g_entries[g_count].name[sizeof(g_entries[g_count].name)-1] = 0;
        g_entries[g_count].bytes = entry.file_size;
        g_count++;
    }
    fsDirClose(&dir);
    snprintf(g_message, sizeof(g_message), "Found %u valid NRO(s) in SD:/switch", (unsigned)g_count);
}

static void draw(size_t selected, size_t page) {
    consoleClear();
    printf("Brendan NRO Launcher (Ozone/libnx-ounce companion)\n");
    printf("===============================================\n");
    printf("%s\n\n", g_message);
    if (!envHasNextLoad()) {
        printf("No chainload handoff was provided by the current loader.\n");
        printf("Launch this NRO through an Ozone-compatible nx-hbloader.\n\n");
    }
    size_t end = page + PAGE_ROWS;
    if (end > g_count) end = g_count;
    for (size_t i = page; i < end; i++) {
        printf("%c %s  (%lld bytes)\n", i == selected ? '>' : ' ', g_entries[i].name,
            (long long)g_entries[i].bytes);
    }
    printf("\nD-pad: select   A: chainload   B: exit\n");
    printf("Only top-level SD:/switch/*.nro files are scanned.\n");
    if (!g_count) printf("Copy homebrew NROs into SD:/switch and press B to exit.\n");
    consoleUpdate(NULL);
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;
    consoleInit(NULL);
    Result r = fsInitialize();
    if (R_FAILED(r)) {
        printf("fsInitialize failed: 0x%08X\n", (unsigned)r);
        consoleUpdate(NULL);
        while (appletMainLoop()) svcSleepThread(1000000000LL);
        consoleExit(NULL); return 1;
    }
    r = fsOpenSdCardFileSystem(&g_sd);
    if (R_FAILED(r)) {
        printf("Cannot mount SD card: 0x%08X\n", (unsigned)r);
        consoleUpdate(NULL);
        while (appletMainLoop()) svcSleepThread(1000000000LL);
        fsExit(); consoleExit(NULL); return 1;
    }
    g_fs_open = 1;
    scan_sd();
    PadState pad;
    padInitializeDefault(&pad);
    size_t selected = 0, page = 0;
    while (appletMainLoop()) {
        padUpdate(&pad);
        u64 down = padGetButtonsDown(&pad);
        if (down & HidNpadButton_B) break;
        if (g_count && (down & HidNpadButton_Down) && selected + 1 < g_count) selected++;
        if (g_count && (down & HidNpadButton_Up) && selected > 0) selected--;
        if (selected < page) page = selected;
        if (selected >= page + PAGE_ROWS) page = selected - PAGE_ROWS + 1;
        if (down & HidNpadButton_A) {
            if (!g_count) {
                snprintf(g_message, sizeof(g_message), "No valid NRO files found.");
            } else if (!envHasNextLoad()) {
                snprintf(g_message, sizeof(g_message), "Blocked: active loader has no NextLoadPath handoff.");
            } else {
                char path[PATH_BYTES];
                int n = snprintf(path, sizeof(path), "sdmc:/switch/%s", g_entries[selected].name);
                if (n <= 0 || (size_t)n >= sizeof(path)) {
                    snprintf(g_message, sizeof(g_message), "Selected path is too long.");
                } else {
                    Result handoff = envSetNextLoad(path, NULL);
                    if (R_FAILED(handoff)) {
                        snprintf(g_message, sizeof(g_message), "Loader rejected chainload (0x%08X)", (unsigned)handoff);
                    } else {
                        fsFsClose(&g_sd); g_fs_open = 0; fsExit();
                        consoleExit(NULL);
                        exit(0); /* Return to loader; supported loaders perform the next NRO load. */
                    }
                }
            }
        }
        draw(selected, page);
        svcSleepThread(16000000LL);
    }
    if (g_fs_open) { fsFsClose(&g_sd); fsExit(); }
    consoleExit(NULL);
    return 0;
}
