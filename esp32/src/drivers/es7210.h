#pragma once
// ES7210 microphone ADC in I2S slave mode, clocked by the ESP32 (MCLK 256 x fs).
// Register sequence from Espressif's esp_codec_dev es7210 driver as Waveshare's
// 08_Audio_Test uses it: MIC1 + MIC3 at 30 dB, 16-bit I2S, not TDM. Proven on
// the Waveshare ESP32-S3-Touch-LCD-3.49 (agents-deck push-to-talk).
//
// The chip sits on Wire (shared with the board's I/O expander); every call
// here is a handful of register writes.

#include <Arduino.h>
#include <Wire.h>

namespace Es7210 {

constexpr uint8_t ADDR = 0x40;
constexpr uint8_t kGain = 10;   // 30 dB (3 dB steps)

inline uint8_t& offReg() { static uint8_t v = 0x3f; return v; }

inline void wr(uint8_t reg, uint8_t v) {
    Wire.beginTransmission(ADDR);
    Wire.write(reg);
    Wire.write(v);
    Wire.endTransmission();
}

inline uint8_t rd(uint8_t reg) {
    Wire.beginTransmission(ADDR);
    Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return 0;
    if (Wire.requestFrom(ADDR, (uint8_t)1) != 1) return 0;
    return Wire.read();
}

inline void upd(uint8_t reg, uint8_t mask, uint8_t v) { wr(reg, (rd(reg) & ~mask) | (v & mask)); }

// MIC1 and MIC3 on with their gain; MIC2 and MIC4 off.
inline void micSelect() {
    for (uint8_t i = 0; i < 4; i++) upd(0x43 + i, 0x10, 0x00);
    wr(0x4B, 0xff);
    wr(0x4C, 0xff);
    upd(0x01, 0x0b, 0x00);
    wr(0x4B, 0x00);
    upd(0x43, 0x10, 0x10);
    upd(0x43, 0x0f, kGain);
    upd(0x01, 0x15, 0x00);
    wr(0x4C, 0x00);
    upd(0x45, 0x10, 0x10);
    upd(0x45, 0x0f, kGain);
    wr(0x12, 0x00);
}

inline bool present() {
    Wire.beginTransmission(ADDR);
    return Wire.endTransmission() == 0;
}

/** Program the chip once (after Wire is up), left stopped. */
inline void open() {
    wr(0x00, 0xff);
    wr(0x00, 0x41);
    wr(0x01, 0x3f);
    wr(0x09, 0x30);
    wr(0x0A, 0x30);
    wr(0x23, 0x2a);
    wr(0x22, 0x0a);
    wr(0x20, 0x0a);
    wr(0x21, 0x2a);
    upd(0x08, 0x01, 0x00);              // slave: the ESP32 drives the clocks
    wr(0x40, 0x43);
    wr(0x41, 0x70);                     // mic bias 2.87 V
    wr(0x42, 0x70);
    wr(0x07, 0x20);
    wr(0x02, 0xc1);
    micSelect();
    for (uint8_t i = 0; i < 4; i++) upd(0x43 + i, 0x0f, kGain);
    wr(0x11, (rd(0x11) & 0x1c) | 0x60); // 16 bit, I2S
    offReg() = rd(0x01);
}

/** Start converting (I2S clocks must already run). */
inline void start() {
    wr(0x01, offReg());
    wr(0x06, 0x00);
    wr(0x40, 0x43);
    for (uint8_t r = 0x47; r <= 0x4A; r++) wr(r, 0x08);
    micSelect();
    wr(0x40, 0x43);
    wr(0x00, 0x71);
    wr(0x00, 0x41);
}

inline void stop() {
    for (uint8_t r = 0x47; r <= 0x4C; r++) wr(r, 0xff);
    wr(0x40, 0xc0);
    wr(0x01, 0x7f);
    wr(0x06, 0x07);
}

}  // namespace Es7210
