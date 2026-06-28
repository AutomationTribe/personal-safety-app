import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { supabase } from '../lib/supabase';

// Configure once at module load — must run before any sign-in attempt
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
});

export type GoogleSignInResult =
  | { success: true; isNewUser: boolean }
  | { success: false; error: string };

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const userInfo = await GoogleSignin.signIn();
    const idToken = userInfo.data?.idToken;

    if (!idToken) {
      return { success: false, error: 'No ID token returned from Google' };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (error) {
      console.error('[GoogleAuth] Supabase error:', error.message);
      return { success: false, error: error.message };
    }

    const user = data.user;
    // Supabase sets created_at === last_sign_in_at on the very first sign-in
    const isNewUser = user?.created_at === user?.last_sign_in_at;

    if (isNewUser && user) {
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (!existingProfile) {
        await supabase.from('profiles').insert({
          id: user.id,
          full_name: (user.user_metadata?.full_name as string | undefined) ?? '',
          subscription_status: 'free',
        });
      }
    }

    console.log('[GoogleAuth] success | isNewUser:', isNewUser);
    return { success: true, isNewUser: isNewUser ?? false };

  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: string }).code;
      if (code === statusCodes.SIGN_IN_CANCELLED) return { success: false, error: 'cancelled' };
      if (code === statusCodes.IN_PROGRESS) return { success: false, error: 'in_progress' };
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { success: false, error: 'Play Services not available on this device' };
      }
    }
    const msg = err instanceof Error ? err.message : 'Google sign-in failed';
    console.error('[GoogleAuth] error:', msg);
    return { success: false, error: msg };
  }
}
