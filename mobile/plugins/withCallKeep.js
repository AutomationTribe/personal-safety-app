const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

// react-native-callkeep's own AndroidManifest.xml (merged automatically by
// the Android Gradle manifest merger) already declares CALL_PHONE,
// READ_PHONE_STATE, READ_PHONE_NUMBERS and MANAGE_OWN_CALLS — this plugin
// only adds what the *app* still has to declare itself: the foreground
// service permissions and the VoiceConnectionService entry (which needs an
// app-specific label), per react-native-callkeep's Android install steps.
const VOICE_CONNECTION_SERVICE = 'io.wazo.callkeep.VoiceConnectionService';

function ensurePermission(androidManifest, name) {
  const manifest = androidManifest.manifest;
  if (!manifest['uses-permission']) manifest['uses-permission'] = [];
  const exists = manifest['uses-permission'].some(
    (p) => p.$ && p.$['android:name'] === name,
  );
  if (!exists) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

function withCallKeepAndroid(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    ensurePermission(androidManifest, 'android.permission.FOREGROUND_SERVICE');
    ensurePermission(androidManifest, 'android.permission.FOREGROUND_SERVICE_PHONE_CALL');

    const application = androidManifest.manifest.application[0];
    if (!application.service) application.service = [];
    const alreadyDeclared = application.service.some(
      (s) => s.$ && s.$['android:name'] === VOICE_CONNECTION_SERVICE,
    );
    if (!alreadyDeclared) {
      application.service.push({
        $: {
          'android:name': VOICE_CONNECTION_SERVICE,
          'android:label': config.name || 'Hadin',
          'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
          'android:foregroundServiceType': 'phoneCall',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }],
          },
        ],
      });
    }
    return config;
  });
}

function withCallKeepIOS(config) {
  return withInfoPlist(config, (config) => {
    const existing = config.modResults.UIBackgroundModes ?? [];
    const modes = new Set(existing);
    modes.add('audio');
    modes.add('voip');
    config.modResults.UIBackgroundModes = Array.from(modes);
    return config;
  });
}

module.exports = function withCallKeep(config) {
  config = withCallKeepAndroid(config);
  config = withCallKeepIOS(config);
  return config;
};
