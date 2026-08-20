export { supabase as default, supabase } from "./lib/supabase/client";
export { db } from "./lib/supabase/firestoreCompat";
export { supabase as authClient } from "./lib/supabase/client";

import { supabase } from "./lib/supabase/client";
export const auth = supabase.auth;
export const storage = supabase.storage;
