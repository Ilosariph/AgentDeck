#pragma once

// T-Display-S3-Pro "Focus Strip" — a 480x222 always-on desk strip.
// Pages: prioritized focus, Claude/Codex usage, and high-value session rows.
// Physical controls: split rocker = previous/next, BOOT = focus/select,
// RST = hardware recovery. Touch provides tabs, swipes and explicit actions;
// a hold on the Usage page switches to portrait Pocket (StripLayout).

#include "../../input/touch_strip.h"
#include <stddef.h>
#include <stdint.h>

namespace Ticker {

void create();
void update(float dt);

void nextPage();
void prevPage();
void primaryAction();
void buttonFeedback(uint8_t button);
/** Short status flash (e.g. the layout-switch restart notice). */
void notify(const char* text);

void onTouch(const Input::TouchEvent& event);

/** Daemon's photo_result for a snap sent from the CAM page. */
void onPhotoResult(bool delivered, const char* detail);
#if defined(BOARD_HAS_VOICE_CAPTURE)
// Push-to-talk (hold BOOT). The transcript comes back as a draft the board
// sends or clears; the daemon holds the text (voice_confirm).
/** The session a recording goes to (pinned, else the focus pick). UI task. */
bool voiceTarget(char* id, size_t idLen);
/** Recording started (true) or stopped and uploading (false). UI task. */
void voiceRecording(bool on);
/** Recording dropped before upload (too short, no WiFi). UI task. */
void voiceCancelled();
bool voiceDraftActive();
void voiceSend();
void voiceClear();
/** voice_result from the daemon (network task): `pending` = a draft held for
 *  send/clear; otherwise `note` is the outcome to flash. */
void onVoiceResult(const char* text, bool pending, const char* note);
#endif
#if defined(BOARD_HAS_MEDIA_PAGE)
/** media_state from the daemon (network task): the host's MPRIS player. */
void onMediaState(const char* player, const char* status, const char* title, const char* artist,
                  uint32_t posMs, uint32_t lenMs, float rate, bool canRate, uint8_t players,
                  int32_t localDayMs);
#endif
#if defined(BOARD_HAS_HOST_LOCK)
/** host_lock from the daemon (network task): the PC's screen is locked. */
void onHostLock(bool locked);
/** True while locked: the board shows the lock screen and ignores input. */
bool hostLocked();
#endif
#if defined(SIM_HOST)
const char* displayedSessionId();
bool isPinned();
unsigned currentPage();
#endif

}  // namespace Ticker
