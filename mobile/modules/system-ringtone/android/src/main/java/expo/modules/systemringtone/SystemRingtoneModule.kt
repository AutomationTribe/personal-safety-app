package expo.modules.systemringtone

import android.content.Context
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Plays/stops the device's actual default ringtone via android.media.Ringtone
// — unlike playing an audio file through expo-av (which goes out on the
// media stream), Ringtone.play() routes through the RINGTONE audio stream
// (AudioAttributes.USAGE_NOTIFICATION_RINGTONE), so it automatically follows
// the phone's ringer volume and is silent when the phone is on
// silent/vibrate — exactly like a real incoming call, with no manual
// volume/ringer-mode checking needed on the JS side.
class SystemRingtoneModule : Module() {
  private var ringtone: Ringtone? = null

  override fun definition() = ModuleDefinition {
    Name("SystemRingtone")

    AsyncFunction<Unit>("play") {
      stopInternal()
      val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
      val r = if (uri != null) RingtoneManager.getRingtone(context, uri) else null
      if (r != null) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          r.isLooping = true
        }
        ringtone = r
        r.play()
      }
    }

    AsyncFunction<Unit>("stop") {
      stopInternal()
    }
  }

  private fun stopInternal() {
    ringtone?.let {
      if (it.isPlaying) it.stop()
    }
    ringtone = null
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
