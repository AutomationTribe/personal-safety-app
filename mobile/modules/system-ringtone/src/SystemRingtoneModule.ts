import { NativeModule, requireNativeModule } from 'expo';

import { SystemRingtoneModuleEvents } from './SystemRingtone.types';

declare class SystemRingtoneModule extends NativeModule<SystemRingtoneModuleEvents> {
  play(): Promise<void>;
  stop(): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<SystemRingtoneModule>('SystemRingtone');
