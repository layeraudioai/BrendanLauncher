/*
 * BrendanLauncher System Monitor
 *
 * Current ABI exposes a monotonic counter and app timing, but does not expose
 * verified clock/thermal sensor APIs. Do not present timer frequency as CPU
 * MHz or guess sensor values. This screen reports those fields as unavailable
 * and offers a small, bounded, read-only CPU throughput check.
 */
#include "hbx_sdk.h"
#include "hbx_app.h"
#include "hbx_ui.h"

#define BENCH_ITERATIONS 350000u

static void copy_text(char *out, const char *text) {
    size_t i = 0;
    while (text[i]) { out[i] = text[i]; i++; }
    out[i] = 0;
}

static void append_char(char *out, size_t *at, char c) {
    if (*at < 62u) out[(*at)++] = c;
}

static void append_u64(char *out, size_t *at, uint64_t value) {
    char digits[24];
    size_t count = 0;
    do { digits[count++] = (char)('0' + value % 10u); value /= 10u; } while (value && count < sizeof digits);
    while (count) append_char(out, at, digits[--count]);
}

static void format_counter(uint64_t hz, char out[64]) {
    size_t at = 0;
    if (!hz) { copy_text(out, "unknown"); return; }
    append_u64(out, &at, hz / 1000000u);
    append_char(out, &at, '.');
    append_char(out, &at, (char)('0' + (hz % 1000000u) / 100000u));
    out[at++] = ' ';
    out[at++] = 'M'; out[at++] = 'H'; out[at++] = 'z'; out[at] = 0;
}

static uint64_t run_cpu_trial(const struct hbx_ctx *ctx) {
    volatile uint64_t state = 0x9e3779b97f4a7c15ull;
    uint64_t start = hbx_now_ns(ctx);
    uint32_t i;
    for (i = 0; i < BENCH_ITERATIONS; i++) {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        state *= 0x2545f4914f6cdd1dull;
    }
    /* Keep the result observable without adding I/O or changing device state. */
    __asm__ volatile("" : "+r"(state) : : "memory");
    uint64_t end = hbx_now_ns(ctx);
    return end > start ? end - start : 0;
}

static uint64_t format_benchmark(char out[96], uint64_t elapsed_ns) {
    size_t at = 0;
    uint64_t operations_per_second;
    if (!elapsed_ns) {
        copy_text(out, "No valid timer sample; try again.");
        return 0;
    }
    operations_per_second = ((uint64_t)BENCH_ITERATIONS * 1000000000ull) / elapsed_ns;
    copy_text(out, "CPU trial: ");
    while (out[at]) at++;
    append_u64(out, &at, operations_per_second);
    copy_text(out + at, " rounds/s (throughput only)");
    return operations_per_second;
}

int hbx_app_main(const struct hbx_ctx *ctx) {
    struct hbx_input_state input;
    uint64_t trial_ns = 0;
    char counter[64];
    char trial[96] = "Press A to run the short CPU trial.";
    if (hbx_ctx_check(ctx) != HBX_OK) return HBX_ERR_ABI;
    hbx_memset(&input, 0, sizeof input);
    format_counter(ctx->tick_hz, counter);
    hbx_log(ctx, "system-monitor: read-only diagnostics ready");

    while (!hbx_stop_requested(ctx)) {
        hbx_input_poll(ctx, &input);
        if (input.pressed & (HBX_B | HBX_PLUS)) break;
        if (input.pressed & HBX_A) {
            trial_ns = run_cpu_trial(ctx);
            (void)format_benchmark(trial, trial_ns);
        }

        hbx_ui_begin(ctx, HBX_RGB(9, 17, 29));
        hbx_ui_text(ctx, 88.0f, 56.0f, HBX_FONT_H1, "System Monitor", HBX_RGB(235, 244, 255));
        hbx_ui_text(ctx, 90.0f, 112.0f, HBX_FONT_SMALL,
            "Read-only diagnostics · no clock changes", HBX_RGB(144, 171, 198));
        hbx_ui_rect(ctx, 72.0f, 170.0f, 1776.0f, 710.0f, 24.0f, HBX_RGB(20, 32, 49));
        hbx_ui_stroke(ctx, 72.0f, 170.0f, 1776.0f, 710.0f, 24.0f, 1.0f, HBX_RGB(51, 73, 96));

        hbx_ui_text(ctx, 112.0f, 218.0f, HBX_FONT_BODY,
            "CPU cluster / per-core MHz: not exposed by this app ABI", HBX_RGB(224, 234, 246));
        hbx_ui_text(ctx, 112.0f, 270.0f, HBX_FONT_BODY,
            "GPU clock: not exposed; GPU cores do not have independent MHz readouts", HBX_RGB(224, 234, 246));
        hbx_ui_text(ctx, 112.0f, 322.0f, HBX_FONT_BODY,
            "RAM data rate / per-chip temperature: not exposed", HBX_RGB(224, 234, 246));
        hbx_ui_text(ctx, 112.0f, 374.0f, HBX_FONT_BODY,
            "CPU / GPU / board temperatures: no verified sensor API in this runtime", HBX_RGB(224, 234, 246));
        hbx_ui_text(ctx, 112.0f, 426.0f, HBX_FONT_BODY,
            "Panel refresh / temperature: actual panel telemetry not exposed", HBX_RGB(224, 234, 246));

        hbx_ui_rect(ctx, 108.0f, 496.0f, 1704.0f, 112.0f, 16.0f, HBX_RGB(13, 25, 40));
        hbx_ui_text(ctx, 132.0f, 516.0f, HBX_FONT_SMALL,
            "Timer reference (CNTFRQ):", HBX_RGB(154, 184, 211));
        hbx_ui_text(ctx, 540.0f, 516.0f, HBX_FONT_BODY, counter, HBX_RGB(104, 216, 184));
        hbx_ui_text(ctx, 132.0f, 557.0f, HBX_FONT_SMALL,
            "This is the architectural timer rate, NOT the CPU clock frequency.", HBX_RGB(154, 184, 211));

        hbx_ui_text(ctx, 112.0f, 650.0f, HBX_FONT_BODY, "Bounded CPU throughput trial", HBX_RGB(104, 216, 184));
        hbx_ui_text(ctx, 112.0f, 694.0f, HBX_FONT_SMALL,
            "A runs 350,000 integer rounds; it never changes clocks or voltage.", HBX_RGB(154, 184, 211));
        hbx_ui_text(ctx, 112.0f, 742.0f, HBX_FONT_BODY, trial,
            trial_ns ? HBX_RGB(235, 244, 255) : HBX_RGB(154, 184, 211));
        hbx_ui_text(ctx, 112.0f, 822.0f, HBX_FONT_SMALL,
            "B returns to BrendanLauncher", HBX_RGB(104, 216, 184));

        if (hbx_ui_present(ctx) != HBX_OK) break;
        hbx_sleep_ns(15000000ull);
    }
    hbx_log(ctx, "system-monitor: exit");
    return HBX_OK;
}
