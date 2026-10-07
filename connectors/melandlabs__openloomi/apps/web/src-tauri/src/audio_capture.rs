//! System audio capture module for Tauri.
//!
//! Captures system audio (output/loopback) and streams it to the frontend
//! via Tauri events as base64-encoded 16-bit PCM chunks at ~100ms intervals.
//!
//! ## Platform implementations
//!
//! | Platform | Backend | Notes |
//! |---|---|---|
//! | macOS 14.6+ | cpal loopback | System audio capture via CoreAudio |
//! | Windows | cpal (WASAPI loopback) | Captures default output device |
//! | Linux | cpal (PulseAudio/PipeWire monitor) | Auto-detects monitor source |
//!
//! ## Event protocol
//!
//! - `system-audio-started` — emitted once when capture begins, payload:
//!   `{ sample_rate: u32, channels: u16 }`
//! - `system-audio-chunk` — emitted every ~100ms, payload:
//!   `{ data: String (base64 i16 LE PCM), samples: usize, timestamp_ms: u64 }`
//! - `system-audio-stopped` — emitted when capture ends
//! - `system-audio-error` — emitted on capture failure, payload: `{ message: String }`

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime};

static CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);
static CAPTURE_THREAD: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);

/// Target chunk duration in milliseconds.
const CHUNK_DURATION_MS: u64 = 100;

// ─── Event payloads ─────────────────────────────────────────────────

#[derive(Clone, serde::Serialize)]
pub struct SystemAudioStarted {
    pub sample_rate: u32,
    pub channels: u16,
}

#[derive(Clone, serde::Serialize)]
pub struct SystemAudioChunk {
    /// Base64-encoded 16-bit PCM audio, little-endian, mono.
    pub data: String,
    /// Number of samples in this chunk.
    pub samples: usize,
    /// Milliseconds since capture started.
    pub timestamp_ms: u64,
}

#[derive(Clone, serde::Serialize)]
pub struct SystemAudioError {
    pub message: String,
}

// ─── Tauri commands ─────────────────────────────────────────────────

/// Start capturing system audio. Emits events on the app handle.
///
/// Returns immediately; capture runs in a background thread.
/// Fails if capture is already running.
#[tauri::command]
pub async fn start_system_audio_capture<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if CAPTURE_ACTIVE.load(Ordering::SeqCst) {
        return Err("System audio capture is already running".into());
    }

    CAPTURE_ACTIVE.store(true, Ordering::SeqCst);

    let handle = std::thread::Builder::new()
        .name("openloomi-audio-capture".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                platform_capture_loop(app.clone());
            }));

            if let Err(panic_info) = result {
                let msg = format!("Audio capture thread panicked: {:?}", panic_info);
                log::error!("[AudioCapture] {}", msg);
                let _ = app.emit("system-audio-error", SystemAudioError { message: msg });
            }

            CAPTURE_ACTIVE.store(false, Ordering::SeqCst);
            let _ = app.emit("system-audio-stopped", ());
        })
        .map_err(|e| format!("Failed to spawn capture thread: {}", e))?;

    *CAPTURE_THREAD.lock().unwrap() = Some(handle);
    Ok(())
}

/// Stop the running system audio capture.
///
/// Blocks until the capture thread has exited.
#[tauri::command]
pub async fn stop_system_audio_capture() -> Result<(), String> {
    if !CAPTURE_ACTIVE.load(Ordering::SeqCst) {
        return Ok(());
    }

    CAPTURE_ACTIVE.store(false, Ordering::SeqCst);

    if let Some(handle) = CAPTURE_THREAD.lock().unwrap().take() {
        handle
            .join()
            .map_err(|_| "Capture thread join failed".to_string())?;
    }

    Ok(())
}

/// Check whether system audio capture is currently active.
#[tauri::command]
pub fn is_system_audio_capture_active() -> bool {
    CAPTURE_ACTIVE.load(Ordering::SeqCst)
}

// ─── Platform dispatch ──────────────────────────────────────────────

fn platform_capture_loop<R: Runtime>(app: AppHandle<R>) {
    #[cfg(target_os = "macos")]
    {
        // TEMPORARILY DISABLED: macOS ScreenCaptureKit audio capture
        // Fallback to cpal (no loopback support on macOS - capture will fail)
        cpal_capture::capture(app);
    }

    #[cfg(target_os = "windows")]
    {
        cpal_capture::capture(app);
    }

    #[cfg(target_os = "linux")]
    {
        cpal_capture::capture(app);
    }
}

// ─── Shared utilities ───────────────────────────────────────────────

fn emit_chunk<R: Runtime>(app: &AppHandle<R>, samples_i16: &[i16], timestamp_ms: u64) {
    let mut bytes = Vec::with_capacity(samples_i16.len() * 2);
    for &s in samples_i16 {
        bytes.extend_from_slice(&s.to_le_bytes());
    }

    use base64::Engine;
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let chunk = SystemAudioChunk {
        data,
        samples: samples_i16.len(),
        timestamp_ms,
    };

    if let Err(e) = app.emit("system-audio-chunk", chunk) {
        log::warn!("[AudioCapture] Failed to emit chunk: {}", e);
    }
}

fn emit_error<R: Runtime>(app: &AppHandle<R>, message: impl Into<String>) {
    let msg = message.into();
    log::error!("[AudioCapture] {}", msg);
    let _ = app.emit("system-audio-error", SystemAudioError { message: msg });
}

/// Convert f32 samples (range -1.0..1.0) to i16 PCM.
fn f32_to_i16(samples: &[f32]) -> Vec<i16> {
    samples
        .iter()
        .map(|&s| {
            let clamped = s.clamp(-1.0, 1.0);
            if clamped < 0.0 {
                (clamped * 32768.0) as i16
            } else {
                (clamped * 32767.0) as i16
            }
        })
        .collect()
}

// ─── macOS: ScreenCaptureKit ─────────────────────────────────────────
// TEMPORARILY DISABLED: ScreenCaptureKit audio capture
// #[cfg(target_os = "macos")]
// mod macos {
//     use super::*;
//     use screencapturekit::prelude::*;
//     use std::sync::mpsc;
//
//     /// Discards screen frames — required by ScreenCaptureKit when video dimensions
//     /// are configured, even when we only consume audio output.
//     struct ScreenDiscardHandler;
//
//     impl SCStreamOutputTrait for ScreenDiscardHandler {
//         fn did_output_sample_buffer(
//             &self,
//             _sample: CMSampleBuffer,
//             _output_type: SCStreamOutputType,
//         ) {
//         }
//     }
//
//     /// Handler that receives audio sample buffers from ScreenCaptureKit.
//     struct AudioHandler {
//         tx: mpsc::Sender<Vec<f32>>,
//     }
//
//     impl SCStreamOutputTrait for AudioHandler {
//         fn did_output_sample_buffer(
//             &self,
//             sample: CMSampleBuffer,
//             output_type: SCStreamOutputType,
//         ) {
//             if output_type != SCStreamOutputType::Audio {
//                 return;
//             }
//
//             // Extract audio data from the CMSampleBuffer (ScreenCaptureKit emits f32 PCM).
//             if let Some(audio_buffer_list) = sample.audio_buffer_list() {
//                 for audio_buf in audio_buffer_list.iter() {
//                     let data = audio_buf.data();
//                     let channels = audio_buf.number_channels.max(1) as usize;
//                     let frame_count = data.len() / 4 / channels;
//                     if frame_count == 0 {
//                         continue;
//                     }
//
//                     let mut mono = Vec::with_capacity(frame_count);
//                     for frame in 0..frame_count {
//                         let mut sum = 0.0f32;
//                         for ch in 0..channels {
//                             let offset = (frame * channels + ch) * 4;
//                             if offset + 4 <= data.len() {
//                                 let f32_bytes = [
//                                     data[offset],
//                                     data[offset + 1],
//                                     data[offset + 2],
//                                     data[offset + 3],
//                                 ];
//                                 sum += f32::from_le_bytes(f32_bytes);
//                             }
//                         }
//                         mono.push(sum / channels as f32);
//                     }
//                     let _ = self.tx.send(mono);
//                 }
//             }
//         }
//     }
//
//     pub fn capture<R: Runtime>(app: AppHandle<R>) {
//         log::info!("[AudioCapture] Starting macOS ScreenCaptureKit audio capture");
//
//         if let Err(message) = crate::permissions::ensure_screen_recording_access() {
//             emit_error(&app, message);
//             return;
//         }
//
//         // Get shareable content to build a filter
//         let content = match SCShareableContent::get() {
//             Ok(c) => c,
//             Err(e) => {
//                 emit_error(&app, format!("Failed to get shareable content: {:?}", e));
//                 return;
//             }
//         };
//
//         // Get the first display for system audio capture
//         let display = match content.displays().first() {
//             Some(d) => d.clone(),
//             None => {
//                 emit_error(&app, "No displays found");
//                 return;
//             }
//         };
//
//         // Create a filter that captures the display (system audio)
//         let filter = SCContentFilter::create()
//             .with_display(&display)
//             .with_excluding_windows(&[])
//             .build();
//
//         // ScreenCaptureKit requires valid video dimensions even for audio capture.
//         // Use the display size with a low FPS to keep overhead minimal.
//         let capture_width = display.width().max(2);
//         let capture_height = display.height().max(2);
//
//         let config = SCStreamConfiguration::new()
//             .with_width(capture_width)
//             .with_height(capture_height)
//             .with_fps(1)
//             .with_shows_cursor(false)
//             .with_captures_audio(true)
//             .with_sample_rate(CAPTURE_SAMPLE_RATE as i32)
//             .with_channel_count(2);
//
//         let (tx, rx) = mpsc::channel::<Vec<f32>>();
//         let sample_rate = config.sample_rate().max(CAPTURE_SAMPLE_RATE as i32) as u32;
//
//         let mut stream = SCStream::new(&filter, &config);
//         stream.add_output_handler(ScreenDiscardHandler, SCStreamOutputType::Screen);
//         stream.add_output_handler(AudioHandler { tx }, SCStreamOutputType::Audio);
//
//         log::info!(
//             "[AudioCapture] SCK config: {}x{}, {}Hz, channels={}",
//             capture_width,
//             capture_height,
//             sample_rate,
//             config.channel_count()
//         );
//
//         if let Err(e) = stream.start_capture() {
//             emit_error(
//                 &app,
//                 format!("Failed to start ScreenCaptureKit stream: {:?}", e),
//             );
//             return;
//         }
//
//         // Notify frontend that capture has started
//         let _ = app.emit(
//             "system-audio-started",
//             SystemAudioStarted {
//                 sample_rate,
//                 channels: 1,
//             },
//         );
//
//         log::info!(
//             "[AudioCapture] ScreenCaptureKit stream started at {}Hz",
//             sample_rate
//         );
//
//         // Collect samples and emit chunks
//         let chunk_samples = (sample_rate as u64 * CHUNK_DURATION_MS / 1000) as usize;
//         let mut buffer: Vec<f32> = Vec::new();
//         let start_time = std::time::Instant::now();
//
//         while CAPTURE_ACTIVE.load(Ordering::SeqCst) {
//             match rx.recv_timeout(std::time::Duration::from_millis(200)) {
//                 Ok(samples) => {
//                     buffer.extend_from_slice(&samples);
//
//                     while buffer.len() >= chunk_samples {
//                         let chunk: Vec<f32> = buffer.drain(..chunk_samples).collect();
//                         let i16_samples = f32_to_i16(&chunk);
//                         let timestamp_ms = start_time.elapsed().as_millis() as u64;
//                         emit_chunk(&app, &i16_samples, timestamp_ms);
//                     }
//                 }
//                 Err(mpsc::RecvTimeoutError::Timeout) => continue,
//                 Err(mpsc::RecvTimeoutError::Disconnected) => {
//                     log::info!("[AudioCapture] Channel disconnected, stopping");
//                     break;
//                 }
//             }
//         }
//
//         if let Err(e) = stream.stop_capture() {
//             log::warn!("[AudioCapture] Error stopping stream: {:?}", e);
//         }
//
//         log::info!("[AudioCapture] macOS ScreenCaptureKit capture ended");
//     }
// }

// ─── Windows / Linux / macOS fallback: cpal loopback ────────────────

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
mod cpal_capture {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::mpsc;

    /// Find the best loopback device for the current platform.
    fn find_loopback_device(host: &cpal::Host) -> Option<cpal::Device> {
        #[cfg(target_os = "linux")]
        {
            // On Linux with PulseAudio/PipeWire, use the default input device.
            // Note: device.name() via DeviceTrait may not work reliably on Linux ALSA,
            // so we rely on the system default which is typically the monitor source
            // when running in a PA/PW session.
            return host.default_input_device();
        }

        #[cfg(target_os = "windows")]
        {
            // On Windows, WASAPI loopback uses the default output device
            return host.default_output_device();
        }

        #[cfg(target_os = "macos")]
        {
            // On macOS 14.6+, cpal supports loopback recording via default output device
            return host.default_output_device();
        }

        #[allow(unreachable_code)]
        None
    }

    pub fn capture<R: Runtime>(app: AppHandle<R>) {
        log::info!("[AudioCapture] Starting cpal loopback capture");

        #[cfg(target_os = "macos")]
        if !crate::permissions::is_system_audio_granted() {
            emit_error(
                &app,
                "System audio permission not granted. Enable System Audio for this app in \
                 System Settings → Privacy & Security → Screen & System Audio Recording.",
            );
            return;
        }

        let host = cpal::default_host();

        let device = match find_loopback_device(&host) {
            Some(d) => d,
            None => {
                emit_error(&app, "No loopback device found");
                return;
            }
        };

        let device_name = format!("{}", device);

        // Get device config. On Windows/macOS, loopback uses the output config.
        let config = if cfg!(any(target_os = "windows", target_os = "macos")) {
            match device.default_output_config() {
                Ok(c) => c,
                Err(e) => {
                    emit_error(
                        &app,
                        format!("Failed to get output config for '{}': {}", device_name, e),
                    );
                    return;
                }
            }
        } else {
            match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    emit_error(
                        &app,
                        format!("Failed to get input config for '{}': {}", device_name, e),
                    );
                    return;
                }
            }
        };

        let sample_rate = config.sample_rate();
        let channels = config.channels() as usize;

        log::info!(
            "[AudioCapture] Using device: {}, sample_rate: {}, channels: {}",
            device_name,
            sample_rate,
            channels
        );

        let (tx, rx) = mpsc::channel::<Vec<f32>>();

        let stream_config: cpal::StreamConfig = config.into();

        let err_fn = move |err: cpal::Error| {
            log::error!("[AudioCapture] Stream error: {}", err);
        };

        let stream = match device.build_input_stream(
            stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !CAPTURE_ACTIVE.load(Ordering::SeqCst) {
                    return;
                }
                // Downmix to mono if multi-channel
                let mono = if channels > 1 {
                    let mut mono = Vec::with_capacity(data.len() / channels);
                    for chunk in data.chunks(channels) {
                        let sum: f32 = chunk.iter().sum();
                        mono.push(sum / channels as f32);
                    }
                    mono
                } else {
                    data.to_vec()
                };
                let _ = tx.send(mono);
            },
            err_fn,
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                emit_error(&app, format!("Failed to build input stream: {}", e));
                return;
            }
        };

        if let Err(e) = stream.play() {
            emit_error(&app, format!("Failed to start stream: {}", e));
            return;
        }

        // Notify frontend only after the native stream is running.
        let _ = app.emit(
            "system-audio-started",
            SystemAudioStarted {
                sample_rate,
                channels: 1, // We downmix to mono
            },
        );

        // Collect samples and emit chunks
        let chunk_samples = (sample_rate as u64 * CHUNK_DURATION_MS / 1000) as usize;
        let mut buffer: Vec<f32> = Vec::new();
        let start_time = std::time::Instant::now();

        while CAPTURE_ACTIVE.load(Ordering::SeqCst) {
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(samples) => {
                    buffer.extend_from_slice(&samples);

                    while buffer.len() >= chunk_samples {
                        let chunk: Vec<f32> = buffer.drain(..chunk_samples).collect();
                        let i16_samples = f32_to_i16(&chunk);
                        let timestamp_ms = start_time.elapsed().as_millis() as u64;
                        emit_chunk(&app, &i16_samples, timestamp_ms);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    log::info!("[AudioCapture] Channel disconnected, stopping");
                    break;
                }
            }
        }

        drop(stream);
        log::info!("[AudioCapture] cpal loopback capture ended");
    }
}
