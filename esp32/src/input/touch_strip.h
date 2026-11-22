#pragma once

#include <cstdint>

// SensorLib touch gesture layer. T-Display Pro uses CST226SE; EPD47 uses
// GT911. Both expose display-oriented coordinates for direct targets/swipes.

namespace Input {

// RELEASE: the finger lifted after a hold or a slow drag (nothing else fired),
// so a drag consumer (the media timeline) always learns where it ended.
enum class TouchGesture : uint8_t { NONE = 0, TAP, HOLD, SWIPE_LEFT, SWIPE_RIGHT, RELEASE };

struct TouchEvent {
    TouchGesture gesture;
    int16_t x;
    int16_t y;
    // Where the finger went down (release gestures; 0 for HOLD/NONE).
    int16_t startX;
    int16_t startY;
};

bool touchInit();
bool touchReady();
/** EPD47 boot probe diagnostics. Address is 0 when no supported controller
 * answered; the count includes every I2C peripheral seen on the touch bus. */
uint8_t touchAddress();
uint8_t touchI2cDeviceCount();
bool touchRtcSeen();
TouchEvent touchPoll(uint32_t nowMs);
/** Live drag state from the last touchPoll: true while a finger is down, with
 *  its landscape position and where it went down. */
bool touchActive(int16_t* x, int16_t* y, int16_t* startX, int16_t* startY);

/**
 * Pocket (portrait) mode: the CST226SE's native portrait report matches the
 * rotation-0 display directly, so LVGL's pointer indev reads raw points here
 * and the gesture layer (touchPoll) stays out of the loop — two consumers
 * polling the same controller would fight over press state.
 */
void touchSetPortrait(bool portrait);
bool touchPortrait();
/** Current raw point in display coordinates; true while a finger is down. */
bool touchRawPoint(int16_t* x, int16_t* y);

/** Diagnostics for device_info: raw finger-down poll hits since boot. */
uint32_t touchDownSamples();
/** Diagnostics for device_info: decoded gestures (tap/hold/swipe) since boot. */
uint32_t touchGestures();
/** Diagnostics: last TAP position and max raw coords seen (coordinate-space
 *  forensics for a mis-oriented controller). -1 / 0 until data arrives. */
int16_t touchLastX();
int16_t touchLastY();
int16_t touchMaxX();
int16_t touchMaxY();

}  // namespace Input
