#pragma once
// Waveshare ESP32-S3-Touch-LCD-3.49 drivers: panel, backlight, touch, I/O
// expander and the ES7210 microphone ADC. Header-only, included by exactly one
// translation unit each (display.cpp for the panel/touch, mic_capture.cpp for
// the mic). Ported from the agents-deck firmware for the same board, which was
// brought up on hardware (V2 board, 2026-11-21).

#include "../../boards/board_config.h"

#if defined(BOARD_WAVESHARE_349) && !defined(SIM_HOST)

#include <Arduino.h>
#include <Wire.h>
#include <Arduino_GFX_Library.h>
#include <esp_heap_caps.h>

namespace Ws349 {

constexpr int kW = SCREEN_W, kH = SCREEN_H;                  // the landscape frame (640x172)
constexpr int kPanelCols = BOARD_NATIVE_W, kPanelRows = BOARD_NATIVE_H;
constexpr uint8_t ADDR_TCA9554 = 0x20;
constexpr uint8_t EXIO_BL_EN = 1 << 1;     // V2: backlight driver enable (high = on)
constexpr uint8_t EXIO_BAT_HOLD = 1 << 6;  // keeps the board on when it runs on the battery

inline bool i2cPresent(TwoWire& w, uint8_t addr) {
    w.beginTransmission(addr);
    return w.endTransmission() == 0;
}

// ── TCA9554 expander ────────────────────────────────────────────────────────

inline bool& haveTca() { static bool v = false; return v; }
inline uint8_t& exioOut() { static uint8_t v = EXIO_BAT_HOLD | EXIO_BL_EN; return v; }

inline void tcaWrite(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(ADDR_TCA9554);
    Wire.write(reg);
    Wire.write(value);
    Wire.endTransmission();
}

inline void exio(uint8_t bit, bool high) {
    exioOut() = high ? (exioOut() | bit) : (exioOut() & ~bit);
    if (haveTca()) tcaWrite(0x01, exioOut());
}

/** Main I2C bus + battery latch. Idempotent; call as early as possible. */
inline void earlyPower() {
    static bool done = false;
    if (done) return;
    done = true;
    Wire.begin(BOARD_PIN_I2C_SDA, BOARD_PIN_I2C_SCL, 400000);
    haveTca() = i2cPresent(Wire, ADDR_TCA9554);
    if (!haveTca()) return;
    tcaWrite(0x01, exioOut());                                  // output port
    tcaWrite(0x03, (uint8_t)~(EXIO_BAT_HOLD | EXIO_BL_EN));     // configuration: 0 = output
}

// ── Backlight: PWM active low (V2 GPIO42, V1 GPIO8), V2 enable on EXIO1 ────

inline void backlightBegin() { ledcAttach(BOARD_PIN_BL, 50000, 8); }

inline void brightness(uint8_t level) {
    exio(EXIO_BL_EN, level > 0);
    ledcWrite(BOARD_PIN_BL, 255 - level);
}

// ── Panel ───────────────────────────────────────────────────────────────────
// The AXS15231B runs on its defaults; only sleep-out, pixel format, the column
// and row windows and display-on are sent. In QSPI mode it ignores the window
// for writes, so a frame always goes out whole from 0x2C.

class Panel {
public:
    bool begin() {
        bus_ = new Arduino_ESP32QSPI(BOARD_PIN_QSPI_CS, BOARD_PIN_QSPI_CLK, BOARD_PIN_QSPI_D0,
                                     BOARD_PIN_QSPI_D1, BOARD_PIN_QSPI_D2, BOARD_PIN_QSPI_D3);
        if (!bus_ || !bus_->begin(40000000)) return false;
        strip_ = (uint16_t*)heap_caps_malloc(kPanelCols * kStripRows * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
        if (!strip_) return false;

        pinMode(BOARD_PIN_LCD_RST, OUTPUT);
        digitalWrite(BOARD_PIN_LCD_RST, HIGH);
        delay(30);
        digitalWrite(BOARD_PIN_LCD_RST, LOW);
        delay(250);
        digitalWrite(BOARD_PIN_LCD_RST, HIGH);
        delay(30);

        bus_->beginWrite();
        bus_->writeCommand(0x11);                          // sleep out
        bus_->endWrite();
        delay(100);
        bus_->beginWrite();
        bus_->writeC8D8(0x36, 0x00);                       // MADCTL: the panel's own orientation
        bus_->writeC8D8(0x3A, 0x55);                       // RGB565
        bus_->writeC8D16D16(0x2A, 0, kPanelCols - 1);
        // V2 keeps the last row window (e.g. ESPHome's) through reset, which
        // left all but a sliver of the screen undrawn.
        bus_->writeC8D16D16(0x2B, 0, kPanelRows - 1);
        bus_->writeCommand(0x29);                          // display on
        bus_->endWrite();
        delay(100);
        return true;
    }

    /** Push a whole landscape frame (kW x kH, native RGB565), turned 90 degrees
     *  clockwise into the portrait panel. Walks frame rows in order (PSRAM). */
    void push(const uint16_t* frame) {
        if (!bus_ || !strip_) return;
        bus_->beginWrite();
        bus_->writeCommand(0x2C);
        for (int r0 = 0; r0 < kPanelRows; r0 += kStripRows) {
            for (int c = 0; c < kPanelCols; c++) {
                const uint16_t* src = frame + (kH - 1 - c) * kW + r0;
                for (int k = 0; k < kStripRows; k++) strip_[k * kPanelCols + c] = *src++;
            }
            bus_->writePixels(strip_, kPanelCols * kStripRows);
        }
        bus_->endWrite();
    }

private:
    static constexpr int kStripRows = 32;   // panel rows per transfer
    Arduino_ESP32QSPI* bus_ = nullptr;
    uint16_t* strip_ = nullptr;             // internal RAM
};

// ── Touch (AXS15231B controller, own bus on Wire1) ─────────────────────────

inline bool& haveTouch() { static bool v = false; return v; }

inline bool touchBegin() {
    Wire1.begin(BOARD_PIN_TOUCH_SDA, BOARD_PIN_TOUCH_SCL, 300000);
    haveTouch() = i2cPresent(Wire1, BOARD_TOUCH_ADDR);
    return haveTouch();
}

// False also for the filler bytes the chip returns between reports: it never
// reports a lift, it only stops reporting.
inline bool touchRaw(int& rx, int& ry) {
    static const uint8_t cmd[11] = {0xB5, 0xAB, 0xA5, 0x5A, 0x00, 0x00, 0x00, 0x0E, 0x00, 0x00, 0x00};
    Wire1.beginTransmission(BOARD_TOUCH_ADDR);
    Wire1.write(cmd, sizeof cmd);
    if (Wire1.endTransmission(false) != 0) return false;
    uint8_t d[8] = {0};
    if (Wire1.requestFrom((uint8_t)BOARD_TOUCH_ADDR, (uint8_t)sizeof d) != sizeof d) return false;
    for (auto& b : d) b = Wire1.read();
    const int n = d[1];
    rx = (d[2] & 0x0F) << 8 | d[3];
    ry = (d[4] & 0x0F) << 8 | d[5];
    return d[0] == 0 && n > 0 && n < 5 && rx <= kPanelRows && ry <= kPanelCols;
}

/** Finger position in landscape frame coordinates; true while down. A lift is
 *  only declared after a few filler reads and 60 ms without a report, so one
 *  filler read between two slow polls never ends a drag or a hold. */
inline bool touch(int16_t& x, int16_t& y) {
    constexpr int kLiftReads = 3;
    constexpr uint32_t kLiftMs = 60;
    static bool lastDown = false;
    static int16_t lastX = 0, lastY = 0;
    static int bad = 0;
    static uint32_t lastPoll = 0, lastReport = 0;
    if (!haveTouch()) return false;
    const uint32_t now = millis();
    if (now - lastPoll < 15) { x = lastX; y = lastY; return lastDown; }
    lastPoll = now;
    int rx, ry;
    if (touchRaw(rx, ry)) {
        bad = 0;
        lastReport = now;
        const int pc = constrain(ry, 0, kPanelCols - 1);              // panel column
        const int pr = constrain(kPanelRows - rx, 0, kPanelRows - 1); // panel row
        lastX = (int16_t)pr;
        lastY = (int16_t)(kH - 1 - pc);
        lastDown = true;
    } else if (lastDown && ++bad >= kLiftReads && now - lastReport >= kLiftMs) {
        lastDown = false;
    }
    x = lastX;
    y = lastY;
    return lastDown;
}

}  // namespace Ws349

#endif  // BOARD_WAVESHARE_349 && !SIM_HOST
