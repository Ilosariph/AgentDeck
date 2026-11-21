#pragma once

// ===== Waveshare ESP32-S3-Touch-LCD-3.49 (AXS15231B QSPI 172x640 + touch) =====
// MCU: ESP32-S3R8 (16MB flash, 8MB octal PSRAM). Runs the Focus Strip render
// tree (ui/ticker/) landscape at 640x172, plus push-to-talk on the ES7210
// microphone ADC. Pins from Waveshare's demos; the drivers live in
// src/drivers/waveshare_349.h (panel, backlight, touch, expander, mic).
//
// Board V2 (backlight GPIO42 + expander EXIO1) and V1 (GPIO8) differ only in
// the backlight pin: BOARD_349_V1 selects the original.

#define BOARD_DISPLAY_TYPE   DISPLAY_AXS15231B_QSPI

// Panel (native portrait 172x640; the strip turns it 90 degrees in software)
#define BOARD_PIN_QSPI_CS    9
#define BOARD_PIN_QSPI_CLK   10
#define BOARD_PIN_QSPI_D0    11
#define BOARD_PIN_QSPI_D1    12
#define BOARD_PIN_QSPI_D2    13
#define BOARD_PIN_QSPI_D3    14
#define BOARD_PIN_LCD_RST    21
#if defined(BOARD_349_V1)
#define BOARD_PIN_BL         8
#else
#define BOARD_PIN_BL         42
#endif
#define BOARD_NATIVE_W       172
#define BOARD_NATIVE_H       640

// Touch: the AXS15231B's own controller on its private bus (I2C 0x3B)
#define BOARD_PIN_TOUCH_SDA  17
#define BOARD_PIN_TOUCH_SCL  18
#define BOARD_TOUCH_ADDR     0x3B

// Main I2C bus: TCA9554 expander (0x20), ES7210 mic ADC (0x40), RTC, IMU
#define BOARD_PIN_I2C_SDA    47
#define BOARD_PIN_I2C_SCL    48

// Buttons: BOOT (GPIO0, strap pin — runtime-safe) and PWR (GPIO16)
#define BOARD_PIN_BTN_BOOT   0
#define BOARD_PIN_BTN_PWR    16

// Push-to-talk: ES7210 in I2S slave mode, 16 kHz, MIC1 + MIC3 averaged.
// The whole utterance is buffered in PSRAM and POSTed once (no live stream).
#define BOARD_HAS_VOICE_CAPTURE 1
#define BOARD_VOICE_HTTP_UPLOAD 1
#define BOARD_MIC_ES7210        1
#define BOARD_PIN_I2S_MCLK   7
#define BOARD_PIN_I2S_BCLK   15
#define BOARD_PIN_I2S_WS     46
#define BOARD_PIN_I2S_DIN    6
#define BOARD_PIN_I2S_DOUT   45
