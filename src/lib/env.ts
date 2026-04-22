const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const isValidSupabaseUrl = Boolean(supabaseUrl && /^https:\/\//i.test(supabaseUrl));
const isValidSupabaseAnonKey = Boolean(supabaseAnonKey && supabaseAnonKey.length >= 40);
const supabaseEnvError = !supabaseUrl || !supabaseAnonKey
	? 'Missing Supabase env vars. Define EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
	: !isValidSupabaseUrl
		? 'Invalid Supabase URL. EXPO_PUBLIC_SUPABASE_URL must start with https://.'
		: !isValidSupabaseAnonKey
			? 'Invalid Supabase anon key. EXPO_PUBLIC_SUPABASE_ANON_KEY looks too short.'
			: null;

if (supabaseEnvError) {
	console.warn(supabaseEnvError);
}

const hasSupabaseEnv = supabaseEnvError === null;

export { supabaseUrl, supabaseAnonKey, hasSupabaseEnv, supabaseEnvError };