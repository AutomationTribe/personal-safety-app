import { Audio } from 'expo-av';
import { File } from 'expo-file-system';
import { supabase } from '../lib/supabase';

// Records audio in rolling 30s chunks for the duration of an active SOS and
// uploads each chunk to the private 'sos-audio' Storage bucket as
// [sos_event_id]/[chunk_n].m4a (see supabase/migrations/010_sos_audio_storage.sql).
// Never blocks or fails the SOS trigger itself — every failure path here is
// swallowed and logged, per flows/mobile/sos-manual.md.

const CHUNK_DURATION_MS = 30_000;

let _recording: Audio.Recording | null = null;
let _chunkTimer: ReturnType<typeof setTimeout> | null = null;
let _chunkIndex = 0;
// The index of the chunk currently being recorded — distinct from
// `_chunkIndex`, which is already incremented to the *next* chunk's index
// the moment recording starts (see `startNextChunk`'s post-increment).
let _activeChunkIndex = 0;
let _sosEventId: string | null = null;
let _stopping = false;

async function uploadChunk(uri: string, chunkIndex: number): Promise<void> {
  if (!_sosEventId) return;
  try {
    // `fetch(uri).blob()` on a local `file://` URI fails on Android with a
    // generic "Network request failed" — RN's fetch polyfill doesn't
    // reliably support the file:// scheme. Reading the file directly via
    // expo-file-system's `File.arrayBuffer()` avoids the network stack
    // entirely.
    const arrayBuffer = await new File(uri).arrayBuffer();
    const path = `${_sosEventId}/${chunkIndex}.m4a`;
    const { error } = await supabase.storage.from('sos-audio').upload(path, arrayBuffer, {
      contentType: 'audio/m4a',
      upsert: true,
    });
    if (error) {
      console.warn('[SOSAudio] Upload failed:', error.message);
    } else if (__DEV__) {
      console.log('[SOSAudio] Uploaded chunk', path);
    }
  } catch (err) {
    console.warn('[SOSAudio] Upload error:', err instanceof Error ? err.message : String(err));
  }
}

async function startNextChunk(): Promise<void> {
  if (_stopping || !_sosEventId) return;
  try {
    const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    _recording = recording;
    const myIndex = _chunkIndex++;
    _activeChunkIndex = myIndex;

    _chunkTimer = setTimeout(() => {
      void rotateChunk(myIndex);
    }, CHUNK_DURATION_MS);
  } catch (err) {
    console.warn('[SOSAudio] Failed to start chunk:', err instanceof Error ? err.message : String(err));
  }
}

async function rotateChunk(finishedIndex: number): Promise<void> {
  const recording = _recording;
  _recording = null;
  if (!recording) return;

  try {
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    if (uri) void uploadChunk(uri, finishedIndex);
  } catch (err) {
    console.warn('[SOSAudio] Failed to stop chunk:', err instanceof Error ? err.message : String(err));
  }

  if (!_stopping) void startNextChunk();
}

/**
 * Start rolling 30s-chunk audio recording for an active SOS. No-ops
 * silently (SOS proceeds without audio) if the microphone permission isn't
 * granted or recording otherwise fails to start.
 */
export async function startSOSRecording(sosEventId: string): Promise<void> {
  if (_sosEventId) return; // already recording for an active SOS

  const { status } = await Audio.getPermissionsAsync();
  let granted = status === 'granted';
  if (!granted) {
    const req = await Audio.requestPermissionsAsync().catch(() => ({ status: 'denied' as const }));
    granted = req.status === 'granted';
  }
  if (!granted) {
    console.warn('[SOSAudio] Microphone permission denied — SOS continues without audio');
    return;
  }

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
    });
  } catch (err) {
    console.warn('[SOSAudio] Failed to set audio mode:', err instanceof Error ? err.message : String(err));
    return;
  }

  _sosEventId = sosEventId;
  _chunkIndex = 0;
  _stopping = false;
  await startNextChunk();
}

/**
 * Stop recording (uploading the final in-progress chunk) and reset state.
 * Safe to call even if recording was never started.
 */
export async function stopSOSRecording(): Promise<void> {
  if (!_sosEventId) return;
  _stopping = true;

  if (_chunkTimer) {
    clearTimeout(_chunkTimer);
    _chunkTimer = null;
  }

  const recording = _recording;
  _recording = null;
  if (recording) {
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) await uploadChunk(uri, _activeChunkIndex);
    } catch (err) {
      console.warn('[SOSAudio] Failed to stop final chunk:', err instanceof Error ? err.message : String(err));
    }
  }

  _sosEventId = null;
  _chunkIndex = 0;
  _stopping = false;
}

export function isSOSRecording(): boolean {
  return _sosEventId !== null;
}
